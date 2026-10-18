use super::{Loaded, Resolution};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Bound, Decl, PatParent, SymbolId};
use crate::hir::{self, ExprId, ExprKind, FileKind, ImportEqualsTarget, SpecifierKind, StmtKind, TypeNodeKind};
use crate::node::NodeData;
use crate::util::{FxHashMap, FxHashSet};

pub(super) fn specifiers_followed_without_demand(hir: &hir::File) -> FxHashSet<Atom> {
    let mut followed = FxHashSet::default();
    followed.extend(hir.exports.iter().filter(|it| it.has_module_specifier).map(|it| it.spec));
    followed.extend(hir.stmts.iter().filter_map(|it| match it.kind {
        StmtKind::ExportStar { spec, .. } => Some(spec),
        _ => None,
    }));
    followed.extend(hir.specifier_uses.iter().filter(|it| matches!(it.kind, SpecifierKind::SideEffect | SpecifierKind::ImportType)).map(|it| it.spec));
    followed
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Meaning {
    Type,
    Value,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct Written {
    name: Atom,
    member: Atom,
    meaning: Meaning,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Wanted {
    Range(u32, u32),
    Export(Written),
    EveryExport,
}

#[derive(Default)]
struct Walk<'r> {
    work: Vec<(&'r [u8], Wanted)>,
    wanted_before: FxHashSet<(&'r [u8], Wanted)>,
    to_load: Vec<&'r [u8]>,
    names_by_position: FxHashMap<&'r [u8], Vec<(u32, Written)>>,
    names_seen: FxHashSet<(&'r [u8], Written)>,
    symbols_seen: FxHashSet<(&'r [u8], SymbolId, Atom, Meaning)>,
    ambient_modules: FxHashSet<Atom>,
}

struct File<'a, 's, 'r> {
    path: &'r [u8],
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    imports: &'a mut Vec<Resolution<'r>>,
}

fn names_written_in(hir: &hir::File) -> Vec<(u32, Written)> {
    let of_types = hir.types.iter().filter_map(|node| {
        let (name, meaning) = match node.kind {
            TypeNodeKind::Ref { name, .. } => (name, Meaning::Type),
            TypeNodeKind::Typeof { name, .. } => (name, Meaning::Value),
            _ => return None,
        };
        let mut names = name.iter().map(|it| hir[it].text);
        Some((node.pos, Written { name: names.next()?, member: names.next().unwrap_or(Atom::NONE), meaning }))
    });
    let members: FxHashMap<ExprId, Atom> = (hir.exprs.iter())
        .filter_map(|e| match e.kind {
            ExprKind::Dot { obj, name, .. } => Some((obj, name)),
            _ => None,
        })
        .collect();
    let of_expressions = hir.exprs.iter().enumerate().filter_map(|(at, e)| match e.kind {
        ExprKind::Ident(name) => Some((e.pos, Written { name, member: members.get(&ExprId(at as u32)).copied().unwrap_or(Atom::NONE), meaning: Meaning::Value })),
        _ => None,
    });
    let mut names: Vec<(u32, Written)> = of_types.chain(of_expressions).collect();
    names.sort_unstable_by_key(|it| it.0);
    names
}

impl<'r> Walk<'r> {
    fn want(&mut self, path: &'r [u8], wanted: Wanted) {
        if self.wanted_before.insert((path, wanted)) {
            self.work.push((path, wanted));
        }
    }

    fn follow_import(&mut self, file: &mut File<'_, '_, 'r>, specifier: Atom, wanted: Wanted) {
        if self.ambient_modules.contains(&specifier) {
            return;
        }
        for resolution in file.imports.iter_mut().filter(|it| it.spec == specifier) {
            resolution.should_add_file |= resolution.is_awaited;
            if resolution.should_add_file && resolution.unsupported_extension.is_none() {
                self.to_load.push(resolution.path);
                self.want(resolution.path, wanted);
            }
        }
    }

    fn follow_name(&mut self, file: &mut File<'_, '_, 'r>, written: Written) {
        if self.names_seen.insert((file.path, written))
            && let Some(symbol) = file.bound.lookup(file.bound.scopes[0].locals, written.name)
        {
            self.follow_symbol(file, symbol, written.member, written.meaning);
        }
    }

    fn follow_symbol(&mut self, file: &mut File<'_, '_, 'r>, id: SymbolId, member: Atom, meaning: Meaning) {
        if !self.symbols_seen.insert((file.path, id, member, meaning)) {
            return;
        }
        let (hir, bound) = (file.hir, file.bound);
        let symbol = &bound.symbols[id.idx()];
        let of_whole_module = if member.is_some() { Wanted::Export(Written { name: member, member: Atom::NONE, meaning }) } else { Wanted::EveryExport };
        for &declaration in symbol.decls.as_slice() {
            match declaration {
                Decl::ImportDefault(import) => self.follow_import(file, hir[import].spec, Wanted::Export(Written { name: known::default, member, meaning })),
                Decl::ImportSpec(named) => self.follow_import(file, hir[hir[named].import].spec, Wanted::Export(Written { name: hir[named].imported, member, meaning })),
                Decl::ImportNamespace(import) => self.follow_import(file, hir[import].spec, of_whole_module),
                Decl::ImportEquals(import) if matches!(hir[import].target, ImportEqualsTarget::Require(_)) => {
                    if let ImportEqualsTarget::Require(required) = hir[import].target {
                        self.follow_import(file, required, of_whole_module);
                    }
                }
                Decl::ExportSpec(named) if hir[hir[named].export].has_module_specifier => self.follow_import(file, hir[hir[named].export].spec, Wanted::Export(Written { name: hir[named].local, member, meaning })),
                Decl::ExportSpec(named) => self.follow_name(file, Written { name: hir[named].local, member, meaning }),
                Decl::ExportStarAs(statement) => {
                    if let StmtKind::ExportStar { spec, .. } = hir[statement].kind {
                        self.follow_import(file, spec, of_whole_module);
                    }
                }
                Decl::ExportExpr(statement) if exported_name(hir, statement).is_some() => {
                    if let Some(name) = exported_name(hir, statement) {
                        self.follow_name(file, Written { name, member, meaning });
                    }
                }
                Decl::Var(_) | Decl::Require(_) | Decl::Fn(_) if meaning == Meaning::Type => {}
                Decl::Interface(_) | Decl::Alias(_) if meaning == Meaning::Value => {}
                Decl::Class(class) => {
                    self.want(file.path, Wanted::Range(hir[class].start, hir[class].body_pos));
                    for member in hir[class].members.iter().map(|member| hir[member]) {
                        let written = if member.func.is_some() { hir[member.func].ret } else { member.ty };
                        let to = if written.is_some() { hir[written].end } else { member.loc.end };
                        self.want(file.path, Wanted::Range(member.start, to));
                    }
                }
                _ => {
                    if let Some((from, to)) = range_a_type_depends_on(hir, bound, declaration) {
                        self.want(file.path, Wanted::Range(from, to));
                    }
                }
            }
        }
        if symbol.export_symbol.is_some() {
            self.follow_symbol(file, symbol.export_symbol, member, meaning);
        }
    }

    fn step(&mut self, file: &mut File<'_, '_, 'r>, wanted: Wanted) {
        let (hir, bound) = (file.hir, file.bound);
        if hir.kind == FileKind::Declaration {
            return;
        }
        let whole_modules = || -> Vec<Atom> {
            let stars = bound.export_stars.iter().filter_map(|it| match hir[it.1].kind {
                StmtKind::ExportStar { spec, alias, .. } if alias.is_none() => Some(spec),
                _ => None,
            });
            stars.collect()
        };
        match wanted {
            Wanted::Range(from, to) => {
                let names = self.names_by_position.entry(file.path).or_insert_with(|| names_written_in(hir));
                let first = names.partition_point(|it| it.0 < from);
                let within: Vec<Written> = names[first..].iter().take_while(|it| it.0 < to).map(|it| it.1).collect();
                for written in within {
                    self.follow_name(file, written);
                }
            }
            Wanted::Export(..) | Wanted::EveryExport if bound.file_symbol.is_none() => {}
            Wanted::Export(written) => match bound.lookup(bound.symbols[bound.file_symbol.idx()].exports, written.name) {
                Some(exported) => self.follow_symbol(file, exported, written.member, written.meaning),
                None => {
                    for specifier in whole_modules() {
                        self.follow_import(file, specifier, wanted);
                    }
                }
            },
            Wanted::EveryExport => {
                for &(_, exported) in bound.table(bound.symbols[bound.file_symbol.idx()].exports) {
                    self.follow_symbol(file, exported, Atom::NONE, Meaning::Type);
                    self.follow_symbol(file, exported, Atom::NONE, Meaning::Value);
                }
                for specifier in whole_modules() {
                    self.follow_import(file, specifier, wanted);
                }
            }
        }
    }
}

fn exported_name(hir: &hir::File, statement: hir::StmtId) -> Option<Atom> {
    match hir[statement].kind {
        StmtKind::ExportDefault(exported) | StmtKind::ExportAssign(exported) => match hir[exported].kind {
            ExprKind::Ident(name) => Some(name),
            _ => None,
        },
        _ => None,
    }
}

fn range_a_type_depends_on(hir: &hir::File, bound: &Bound, declaration: Decl) -> Option<(u32, u32)> {
    match declaration {
        Decl::Var(pattern) | Decl::Require(pattern) => match bound.pat_parent[pattern.idx()] {
            PatParent::Var(variable) if hir[variable].ty.is_some() => Some((hir[hir[variable].ty].pos, hir[hir[variable].ty].end)),
            PatParent::Var(variable) => Some((hir[variable].loc.pos, hir[variable].loc.end)),
            _ => None,
        },
        Decl::Fn(function) if hir[function].ret.is_some() => Some((hir[function].start, hir[hir[function].ret].end)),
        _ => match hir.data(hir.node(declaration)) {
            NodeData::Stmt(statement) => Some((hir[statement].loc.pos, hir[statement].loc.end)),
            _ => None,
        },
    }
}

fn written_types_to_validate(hir: &hir::File, atoms: &Interner) -> Vec<(u32, u32)> {
    let is_imported_from_bun = |local: Atom| {
        let from_bun = hir.imports.iter().filter(|import| atoms.bytes(import.spec) == b"bun");
        from_bun.flat_map(|import| [import.default, import.namespace].into_iter().chain(import.named.iter().map(|named| hir[named].local))).any(|it| it == local)
    };
    let calls = hir.exprs.iter().filter_map(|e| match e.kind {
        ExprKind::Call(call) if hir[call].type_args.len == 1 => Some(hir[call]),
        _ => None,
    });
    let validating = calls.filter(|call| match hir[call.callee].kind {
        ExprKind::Dot { name, .. } => matches!(atoms.bytes(name), b"parse" | b"validate"),
        ExprKind::Ident(function) => is_imported_from_bun(function),
        _ => false,
    });
    validating.map(|call| hir[hir.id_at(call.type_args, 0)]).map(|written| (written.pos, written.end)).collect()
}

pub(super) fn load_what_the_written_types_need<'s, 'r>(
    ahead: &mut FxHashMap<&'r [u8], Box<Loaded<'s, 'r>>>,
    atoms: &Interner<'s>,
    is_asked_about: &dyn Fn(&[u8]) -> bool,
    load: &mut dyn FnMut(Vec<(&'r [u8], bool)>) -> FxHashMap<&'r [u8], Box<Loaded<'s, 'r>>>,
) {
    let mut walk = Walk::default();
    walk.ambient_modules.extend(ahead.values().flat_map(|loaded| loaded.module.bound.ambient_modules.iter().map(|it| it.0)));
    for (&path, loaded) in ahead.iter().filter(|it| is_asked_about(it.0)) {
        for (from, to) in written_types_to_validate(&loaded.module.hir, atoms) {
            walk.want(path, Wanted::Range(from, to));
        }
    }
    while !walk.work.is_empty() {
        let mut waiting = Vec::new();
        while let Some((path, wanted)) = walk.work.pop() {
            let Some(loaded) = ahead.get_mut(path) else {
                waiting.push((path, wanted));
                continue;
            };
            let Loaded { module, imports, .. } = &mut **loaded;
            walk.step(&mut File { path, hir: &module.hir, bound: &module.bound, imports }, wanted);
        }
        let mut seeds: Vec<(&'r [u8], bool)> = core::mem::take(&mut walk.to_load).into_iter().filter(|path| !ahead.contains_key(path)).map(|path| (path, false)).collect();
        seeds.sort_unstable();
        seeds.dedup();
        if seeds.is_empty() {
            break;
        }
        ahead.extend(load(seeds));
        walk.work.extend(waiting.into_iter().filter(|it| ahead.contains_key(it.0)));
    }
}
