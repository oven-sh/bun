//! The BIR-level linker: merges the modules of several translation units into one.
//!
//! * Signatures are deduplicated.
//! * Functions are renumbered; `static` ones stay private to their unit, and two units
//!   defining the same external function is an error.
//! * Data is laid out again object by object. Static objects and string literals stay
//!   private; external objects are merged by name (tentative definitions collapse into
//!   one, an initialized definition wins, two initialized definitions are an error).
//! * An extern that another unit defines becomes a direct `Call` / `FuncAddr` / `DataAddr`
//!   (and a `Func` / `Data` relocation); what is still undefined stays an extern, once.
//! * The export table is the union.

use std::collections::BTreeMap;

use crate::bir::{self, ExternKind, Inst, Module, RelocKind, V};
use crate::codegen::Unit;

/// One object in a unit's data segment.
pub(crate) struct DataObject {
    pub(crate) offset: u64,
    pub(crate) size: u64,
    pub(crate) align: u64,
    /// The name other units see; `None` for objects with internal linkage.
    pub(crate) symbol: Option<String>,
    /// Defined with an initializer, as opposed to tentatively (`int x;`).
    pub(crate) initialized: bool,
    /// Sits in the initialized part of the unit's segment (non-zero bytes or relocations).
    pub(crate) content: bool,
    /// Every unit that defines it defines the same thing; the first one is kept.
    pub(crate) linkonce: bool,
    /// The program never writes it (a string literal, a `const` object): it goes among the
    /// constants, which are protected once the module is loaded.
    pub(crate) constant: bool,
}

pub(crate) struct LinkError {
    /// Index of the unit the message is about.
    pub(crate) unit: usize,
    pub(crate) message: String,
    /// Set when the problem is a thread-local object no unit defines: its position in
    /// the unit's `tls_externs`, which knows where it is used.
    pub(crate) undefined_tls: Option<usize>,
}

pub(crate) struct Linked {
    pub(crate) module: Module,
    /// Unit index and text.
    pub(crate) warnings: Vec<(usize, String)>,
}

/// What an extern of one unit turned into.
#[derive(Clone, Copy)]
enum Resolved {
    /// A function of the linked module; `same_sig` when the declaration agreed with it.
    Func { index: u32, same_sig: bool },
    /// An offset into the linked data segment.
    Data(u64),
    /// An offset into the linked tls segment.
    Tls(u64),
    /// Still undefined: an extern of the linked module.
    Extern(u32),
}

fn fail<T>(unit: usize, message: String) -> Result<T, LinkError> {
    Err(LinkError {
        unit,
        message,
        undefined_tls: None,
    })
}

/// The object of `objects` (sorted by offset) that contains `offset`. Empty objects share
/// their address with whatever follows them; a real object is preferred.
fn containing(objects: &[DataObject], offset: u64) -> Option<usize> {
    let upper = objects.partition_point(|o| o.offset <= offset);
    let mut empty = None;
    for index in (0..upper).rev() {
        let object = &objects[index];
        if object.size > 0 {
            return if offset < object.offset + object.size {
                Some(index)
            } else {
                empty
            };
        }
        if object.offset == offset {
            empty = empty.or(Some(index));
        }
    }
    empty
}

/// One of the two segments (data, or thread-local storage) laid out again for the
/// linked module.
struct Segment<'u> {
    tls: bool,
    /// External symbol -> (unit, object index) of the definition that survives.
    chosen: BTreeMap<&'u str, (usize, usize)>,
    /// For every unit, the new offset of each of its objects.
    new_offsets: Vec<Vec<u64>>,
    image: Vec<u8>,
    size: u64,
    align: u64,
    /// Where the constants, which come first, end.
    read_only: u64,
}

fn objects_of(unit: &Unit, tls: bool) -> &[DataObject] {
    if tls {
        &unit.tls_objects
    } else {
        &unit.objects
    }
}

impl<'u> Segment<'u> {
    fn build(
        units: &'u [Unit],
        tls: bool,
        defined_funcs: &BTreeMap<&str, (usize, u32)>,
        names: &[String],
        warnings: &mut Vec<(usize, String)>,
    ) -> Result<Segment<'u>, LinkError> {
        let name_of = |unit: usize| names.get(unit).map_or("?", String::as_str);
        // Pick the definition of every external object that survives.
        let mut chosen: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for (u, unit) in units.iter().enumerate() {
            for (o, object) in objects_of(unit, tls).iter().enumerate() {
                let Some(name) = &object.symbol else { continue };
                if let Some(&(other, _)) = defined_funcs.get(name.as_str()) {
                    return fail(
                        u,
                        format!(
                            "'{name}' is an object in {} and a function in {}",
                            name_of(u),
                            name_of(other)
                        ),
                    );
                }
                match chosen.get(name.as_str()).copied() {
                    None => {
                        chosen.insert(name, (u, o));
                    }
                    Some((pu, po)) => {
                        let previous = &objects_of(&units[pu], tls)[po];
                        if previous.linkonce && object.linkonce {
                            continue;
                        }
                        if previous.initialized && object.initialized {
                            return fail(
                                u,
                                format!(
                                    "duplicate symbol '{name}': defined in {} and in {}",
                                    name_of(pu),
                                    name_of(u)
                                ),
                            );
                        }
                        if previous.size != object.size {
                            warnings.push((
                                u,
                                format!(
                                    "'{name}' has size {} here but size {} in {}",
                                    object.size,
                                    previous.size,
                                    name_of(pu)
                                ),
                            ));
                        }
                        // An initializer wins; between tentative definitions, the larger.
                        let better = (object.initialized && !previous.initialized)
                            || (!previous.initialized && object.size > previous.size);
                        if better {
                            chosen.insert(name, (u, o));
                        }
                    }
                }
            }
        }
        let mut segment = Segment {
            tls,
            chosen,
            new_offsets: units
                .iter()
                .map(|u| vec![0; objects_of(u, tls).len()])
                .collect(),
            image: Vec::new(),
            size: 0,
            align: 1,
            read_only: 0,
        };
        // The constants first, then on a page of its own what is written to: objects with
        // content, and the zero-filled ones after them.
        for (constants, with_content) in [(true, true), (false, true), (false, false)] {
            if !constants && with_content && segment.size > 0 {
                // Whole pages are what can be protected: the constants have theirs to themselves.
                segment.size = segment.size.next_multiple_of(bir::DATA_PAGE);
                segment.read_only = segment.size;
            }
            for (u, unit) in units.iter().enumerate() {
                let init: &[u8] = if tls {
                    &unit.module.tls.init
                } else {
                    &unit.module.data.init
                };
                for (o, object) in objects_of(unit, tls).iter().enumerate() {
                    if object.content != with_content
                        || (object.constant && object.content) != constants
                        || !segment.survives(units, u, o)
                    {
                        continue;
                    }
                    let object_align = object.align.max(1);
                    segment.align = segment.align.max(object_align);
                    segment.size = segment.size.next_multiple_of(object_align);
                    segment.new_offsets[u][o] = segment.size;
                    if with_content {
                        segment.image.resize(segment.size as usize, 0);
                        let start = (object.offset as usize).min(init.len());
                        let end = ((object.offset + object.size) as usize).min(init.len());
                        segment.image.extend_from_slice(&init[start..end]);
                    }
                    segment.size += object.size;
                }
            }
        }
        // Merged duplicates live where the surviving definition lives.
        for (u, unit) in units.iter().enumerate() {
            for (o, object) in objects_of(unit, tls).iter().enumerate() {
                if let (Some(name), false) = (&object.symbol, segment.survives(units, u, o)) {
                    if let Some(&(cu, co)) = segment.chosen.get(name.as_str()) {
                        segment.new_offsets[u][o] = segment.new_offsets[cu][co];
                    }
                }
            }
        }
        Ok(segment)
    }

    fn survives(&self, units: &[Unit], u: usize, o: usize) -> bool {
        match &objects_of(&units[u], self.tls)[o].symbol {
            Some(name) => self.chosen.get(name.as_str()) == Some(&(u, o)),
            None => true,
        }
    }

    /// Where offset `old` of unit `u`'s segment is in the linked segment.
    fn address(&self, units: &[Unit], u: usize, old: u64) -> Result<u64, LinkError> {
        let objects = objects_of(&units[u], self.tls);
        match containing(objects, old) {
            Some(o) => Ok(self.new_offsets[u][o] + (old - objects[o].offset)),
            // An empty segment still has an address.
            None if objects.is_empty() || old == 0 => Ok(0),
            None => fail(
                u,
                format!("internal error: segment offset {old} is in no object"),
            ),
        }
    }

    fn defined(&self, name: &str) -> Option<u64> {
        self.chosen.get(name).map(|&(u, o)| self.new_offsets[u][o])
    }
}

pub(crate) fn link(units: &[Unit], names: &[String]) -> Result<Linked, LinkError> {
    let name_of = |unit: usize| names.get(unit).map_or("?", String::as_str);
    let mut warnings: Vec<(usize, String)> = Vec::new();
    let Some(first) = units.first() else {
        return fail(0, "no input files".to_string());
    };
    let (arch, os) = (first.module.arch, first.module.os);

    // ── Signatures ──
    let mut sigs: Vec<bir::Sig> = Vec::new();
    let mut sig_ids: BTreeMap<bir::Sig, u32> = BTreeMap::new();
    let mut sig_maps: Vec<Vec<u32>> = Vec::with_capacity(units.len());
    for unit in units {
        let map = unit
            .module
            .sigs
            .iter()
            .map(|sig| match sig_ids.get(sig) {
                Some(&id) => id,
                None => {
                    let id = sigs.len() as u32;
                    sigs.push(sig.clone());
                    sig_ids.insert(sig.clone(), id);
                    id
                }
            })
            .collect();
        sig_maps.push(map);
    }

    // ── Functions ──
    let mut func_bases: Vec<u32> = Vec::with_capacity(units.len());
    let mut total_funcs = 0u32;
    // External function name -> (unit, linked index).
    let mut defined_funcs: BTreeMap<&str, (usize, u32)> = BTreeMap::new();
    for (u, unit) in units.iter().enumerate() {
        func_bases.push(total_funcs);
        for (f, func) in unit.module.funcs.iter().enumerate() {
            if !func.exported {
                continue;
            }
            let index = total_funcs + f as u32;
            if let Some(&(other, _)) = defined_funcs.get(func.name.as_str()) {
                return fail(
                    u,
                    format!(
                        "duplicate symbol '{}': defined in {} and in {}",
                        func.name,
                        name_of(other),
                        name_of(u)
                    ),
                );
            }
            defined_funcs.insert(&func.name, (u, index));
        }
        for (name, f) in &unit.function_aliases {
            if let Some(&(other, _)) = defined_funcs.get(name.as_str()) {
                return fail(
                    u,
                    format!(
                        "duplicate symbol '{name}': defined in {} and in {}",
                        name_of(other),
                        name_of(u)
                    ),
                );
            }
            defined_funcs.insert(name, (u, total_funcs + f));
        }
        total_funcs += unit.module.funcs.len() as u32;
    }
    // What nobody defines for the whole program, the first unit that defines it for itself does.
    for (u, unit) in units.iter().enumerate() {
        for (name, f) in &unit.linkonce_functions {
            defined_funcs
                .entry(name.as_str())
                .or_insert((u, func_bases[u] + f));
        }
    }

    // ── Data and thread-local storage ──
    let data = Segment::build(units, false, &defined_funcs, names, &mut warnings)?;
    let tls = Segment::build(units, true, &defined_funcs, names, &mut warnings)?;
    for (name, &(u, _)) in &tls.chosen {
        if let Some(&(other, _)) = data.chosen.get(name) {
            return fail(
                u,
                format!(
                    "'{name}' is thread-local in {} and not in {}",
                    name_of(u),
                    name_of(other)
                ),
            );
        }
    }
    let data_address = |u: usize, old: u64| data.address(units, u, old);
    let defined_data = |name: &str| data.defined(name);
    let mut image = data.image.clone();
    let mut size = data.size;
    let align = data.align;

    // ── Externs ──
    let mut externs: Vec<bir::Extern> = Vec::new();
    let mut extern_ids: BTreeMap<(String, u8, u32), u32> = BTreeMap::new();
    let mut resolved: Vec<Vec<Resolved>> = Vec::with_capacity(units.len());
    for (u, unit) in units.iter().enumerate() {
        let mut map = Vec::with_capacity(unit.module.externs.len());
        for ext in &unit.module.externs {
            let sig = match ext.kind {
                ExternKind::Function => sig_maps[u][ext.sig as usize],
                ExternKind::Data => 0,
            };
            let tls_use = unit
                .tls_externs
                .iter()
                .position(|t| t.index as usize == map.len());
            if let Some(position) = tls_use {
                match tls.defined(&ext.name) {
                    Some(offset) => map.push(Resolved::Tls(offset)),
                    None if defined_data(&ext.name).is_some()
                        || defined_funcs.contains_key(ext.name.as_str()) =>
                    {
                        return fail(
                            u,
                            format!(
                                "'{}' is declared thread-local here but its definition is not",
                                ext.name
                            ),
                        );
                    }
                    None => {
                        return Err(LinkError {
                            unit: u,
                            message: format!(
                                "thread-local variable '{}' is declared but not defined in any translation unit",
                                ext.name
                            ),
                            undefined_tls: Some(position),
                        });
                    }
                }
                continue;
            }
            if ext.kind == ExternKind::Data && tls.defined(&ext.name).is_some() {
                return fail(
                    u,
                    format!(
                        "'{}' is defined thread-local but declared here without _Thread_local",
                        ext.name
                    ),
                );
            }
            let made_up = unit.runtime_externs.contains(&(map.len() as u32));
            let target = match ext.kind {
                ExternKind::Function if made_up => None,
                ExternKind::Function => match defined_funcs.get(ext.name.as_str()) {
                    Some(&(du, index)) => {
                        let local = (index - func_bases[du]) as usize;
                        let definition = sig_maps[du][units[du].module.funcs[local].sig as usize];
                        if definition != sig {
                            warnings.push((
                                u,
                                format!(
                                    "'{}' is declared here with a different type than its definition in {}",
                                    ext.name,
                                    name_of(du)
                                ),
                            ));
                        }
                        Some(Resolved::Func {
                            index,
                            same_sig: definition == sig,
                        })
                    }
                    None if defined_data(&ext.name).is_some() => {
                        return fail(
                            u,
                            format!(
                                "'{}' is called as a function but is defined as an object",
                                ext.name
                            ),
                        );
                    }
                    None => None,
                },
                ExternKind::Data => match defined_data(&ext.name) {
                    Some(offset) => Some(Resolved::Data(offset)),
                    // `extern char f[]` naming a function: its address is all that is used.
                    None => {
                        defined_funcs
                            .get(ext.name.as_str())
                            .map(|&(_, index)| Resolved::Func {
                                index,
                                same_sig: true,
                            })
                    }
                },
            };
            map.push(match target {
                Some(target) => target,
                None => {
                    let key = (ext.name.clone(), ext.kind as u8, sig);
                    let id = match extern_ids.get(&key) {
                        Some(&id) => id,
                        None => {
                            let id = externs.len() as u32;
                            externs.push(bir::Extern {
                                name: ext.name.clone(),
                                kind: ext.kind,
                                weak: ext.weak,
                                sig,
                            });
                            extern_ids.insert(key, id);
                            id
                        }
                    };
                    // One declaration that is not weak makes the symbol required.
                    externs[id as usize].weak &= ext.weak;
                    Resolved::Extern(id)
                }
            });
        }
        resolved.push(map);
    }

    // ── Relocations ──
    let mut relocs: Vec<bir::Reloc> = Vec::new();
    let mut tls_relocs: Vec<bir::Reloc> = Vec::new();
    let mut tls_image = tls.image.clone();
    for in_tls in [false, true] {
        for (u, unit) in units.iter().enumerate() {
            let (segment, objects, unit_relocs) = if in_tls {
                (&tls, &unit.tls_objects, &unit.module.tls.relocs)
            } else {
                (&data, &unit.objects, &unit.module.data.relocs)
            };
            for reloc in unit_relocs {
                let Some(owner) = containing(objects, reloc.offset) else {
                    return fail(
                        u,
                        "internal error: relocation outside every object".to_string(),
                    );
                };
                if !segment.survives(units, u, owner) {
                    continue;
                }
                let offset = segment.new_offsets[u][owner] + (reloc.offset - objects[owner].offset);
                let (kind, index) = match reloc.kind {
                    RelocKind::Data => (RelocKind::Data, data_address(u, reloc.index)?),
                    RelocKind::Tls => (RelocKind::Tls, tls.address(units, u, reloc.index)?),
                    RelocKind::Func => (RelocKind::Func, u64::from(func_bases[u]) + reloc.index),
                    RelocKind::Extern => match resolved[u].get(reloc.index as usize) {
                        Some(Resolved::Func { index, .. }) => (RelocKind::Func, u64::from(*index)),
                        Some(Resolved::Data(offset)) => (RelocKind::Data, *offset),
                        Some(Resolved::Extern(id)) => (RelocKind::Extern, u64::from(*id)),
                        Some(Resolved::Tls(offset)) if in_tls => (RelocKind::Tls, *offset),
                        Some(Resolved::Tls(_)) => {
                            return fail(
                                u,
                                "the address of a thread-local object is not a constant"
                                    .to_string(),
                            );
                        }
                        None => {
                            return fail(
                                u,
                                "internal error: relocation against a missing extern".to_string(),
                            );
                        }
                    },
                };
                // Relocated words must lie in the initialized prefix.
                let end = (offset + 8) as usize;
                let (bytes, table) = if in_tls {
                    (&mut tls_image, &mut tls_relocs)
                } else {
                    (&mut image, &mut relocs)
                };
                if bytes.len() < end {
                    bytes.resize(end, 0);
                }
                table.push(bir::Reloc {
                    offset,
                    kind,
                    index,
                    addend: reloc.addend,
                });
            }
        }
    }
    size = size.max(image.len() as u64);

    // ── Function bodies ──
    let mut funcs: Vec<bir::Func> = Vec::with_capacity(total_funcs as usize);
    let mut exports: Vec<bir::Export> = Vec::new();
    for (u, unit) in units.iter().enumerate() {
        for (f, func) in unit.module.funcs.iter().enumerate() {
            let needs_renumbering = func.blocks.iter().flatten().any(|inst| {
                matches!(inst, Inst::CallExtern(e, _)
                    if matches!(resolved[u].get(*e as usize), Some(Resolved::Func { same_sig: false, .. })))
            });
            let info = if needs_renumbering {
                match bir::analyze(&unit.module, f) {
                    Ok(info) => Some(info),
                    Err(message) => return fail(u, format!("internal error: {message}")),
                }
            } else {
                None
            };
            let nparams = unit
                .module
                .sigs
                .get(func.sig as usize)
                .map_or(0, |sig| sig.params.len()) as V;
            let mut blocks = Vec::with_capacity(func.blocks.len());
            // Value ids run through the whole function, so an inserted instruction moves
            // every later definition; uses only ever refer to their own block.
            let mut shift: V = 0;
            let mut old_next: V = nparams;
            for (bi, block) in func.blocks.iter().enumerate() {
                // Old value id -> new value id for this block's definitions.
                let mut renumber: BTreeMap<V, V> = BTreeMap::new();
                let mut out = Vec::with_capacity(block.len());
                for (ii, inst) in block.iter().enumerate() {
                    let mut inst = inst.clone();
                    if shift > 0 {
                        inst.for_each_value_mut(|v| {
                            if *v >= nparams {
                                if let Some(&new) = renumber.get(v) {
                                    *v = new;
                                }
                            }
                        });
                    }
                    let rewritten = match inst {
                        Inst::Call(target, args) => Inst::Call(func_bases[u] + target, args),
                        Inst::FuncAddr(target) => Inst::FuncAddr(func_bases[u] + target),
                        Inst::CallIndirect(sig, pointer, args) => {
                            Inst::CallIndirect(sig_maps[u][sig as usize], pointer, args)
                        }
                        Inst::DataAddr(old) => Inst::DataAddr(data_address(u, old)?),
                        Inst::TlsAddr(old) => Inst::TlsAddr(tls.address(units, u, old)?),
                        Inst::ExternAddr(e) => match resolved[u].get(e as usize) {
                            Some(Resolved::Func { index, .. }) => Inst::FuncAddr(*index),
                            Some(Resolved::Data(offset)) => Inst::DataAddr(*offset),
                            Some(Resolved::Tls(offset)) => Inst::TlsAddr(*offset),
                            Some(Resolved::Extern(id)) => Inst::ExternAddr(*id),
                            None => return fail(u, "internal error: missing extern".to_string()),
                        },
                        Inst::CallExtern(e, args) => match resolved[u].get(e as usize) {
                            Some(Resolved::Func {
                                index,
                                same_sig: true,
                            }) => Inst::Call(*index, args),
                            Some(Resolved::Func {
                                index,
                                same_sig: false,
                            }) => {
                                // The declaration disagrees with the definition: call through
                                // a pointer with the signature the call site was compiled for.
                                let sig = sig_maps[u][unit.module.externs[e as usize].sig as usize];
                                if info.is_none() {
                                    return fail(
                                        u,
                                        "internal error: no value numbering".to_string(),
                                    );
                                }
                                // The inserted FuncAddr takes the id the call's first result had.
                                let pointer = old_next + shift;
                                out.push(Inst::FuncAddr(*index));
                                shift += 1;
                                Inst::CallIndirect(sig, pointer, args)
                            }
                            Some(Resolved::Extern(id)) => Inst::CallExtern(*id, args),
                            Some(Resolved::Data(_) | Resolved::Tls(_)) | None => {
                                return fail(
                                    u,
                                    "internal error: call of a data symbol".to_string(),
                                );
                            }
                        },
                        other => other,
                    };
                    if let Some(info) = &info {
                        let def = info.defs[bi][ii];
                        if shift > 0 {
                            for k in 0..def.count {
                                renumber.insert(def.first + k, def.first + k + shift);
                            }
                        }
                        old_next += def.count;
                    }
                    out.push(rewritten);
                }
                blocks.push(out);
            }
            funcs.push(bir::Func {
                name: func.name.clone(),
                sig: sig_maps[u][func.sig as usize],
                exported: func.exported,
                returns_twice: func.returns_twice,
                inlining: func.inlining,
                locals: func.locals.clone(),
                slots: func.slots.clone(),
                blocks,
            });
        }
        for export in &unit.module.exports {
            exports.push(bir::Export {
                name: export.name.clone(),
                func: func_bases[u] + export.func,
                ret: export.ret,
                args: export.args.clone(),
            });
        }
        if unit.module.arch != arch || unit.module.os != os {
            return fail(
                u,
                "the translation units were compiled for different targets".to_string(),
            );
        }
    }

    // Priorities order constructors across all units; units keep their order within one.
    let mut constructors = Vec::new();
    let mut destructors = Vec::new();
    for (u, unit) in units.iter().enumerate() {
        let rebase = |entry: &crate::codegen::Initializer| crate::codegen::Initializer {
            priority: entry.priority,
            function: func_bases[u] + entry.function,
        };
        constructors.extend(unit.constructors.iter().map(rebase));
        destructors.extend(unit.destructors.iter().map(rebase));
    }

    let mut libraries: Vec<String> = Vec::new();
    for unit in units {
        for library in &unit.module.libraries {
            if !libraries.contains(library) {
                libraries.push(library.clone());
            }
        }
    }

    Ok(Linked {
        module: Module {
            arch,
            os,
            sigs,
            externs,
            data: bir::Data {
                size,
                align,
                read_only: data.read_only,
                init: image,
                relocs,
            },
            tls: bir::Tls {
                size: tls.size.max(tls_image.len() as u64),
                align: tls.align,
                init: tls_image,
                relocs: tls_relocs,
            },
            funcs,
            exports,
            libraries,
            constructors: crate::codegen::initializer_order(&constructors, false),
            destructors: crate::codegen::initializer_order(&destructors, true),
        },
        warnings,
    })
}
