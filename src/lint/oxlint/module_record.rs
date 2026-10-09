//! oxlint's `ModuleRecord`: what a file imports and exports at its top level, as `oxc_parser` records it ("ParseModule" of the
//! specification), and what its rules of `import` ask the records of other files.
//!
//! - [`ModuleRecord`] is that of the file which is linted, with the places.
//! - [`Record`] is that of another file, without them: [`get_loaded_module`].

use crate::import::{
    ImportEntry, ImportImportName, default_keyword_span, export_declaration_span,
    has_module_syntax, import_entries, is_export_declaration, is_type_export_declaration,
};
use bun_core::strings;
use bun_lint::modules::{self, Flavor, ModuleId, Modules, Record, requests_of};
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

#[derive(Copy, Clone)]
pub struct NameSpan<'a> {
    pub name: Name<'a>,
    pub span: Span,
}

impl<'a> From<Ident<'a>> for NameSpan<'a> {
    fn from(ident: Ident<'a>) -> Self {
        NameSpan {
            name: ident.name(),
            span: ident.span(),
        }
    }
}

/// The name in the other module of what `export .. from` exports.
#[derive(Copy, Clone)]
pub enum ExportImportName<'a> {
    Name(NameSpan<'a>),
    /// `export * as a from "m"`
    All,
    /// `export * from "m"`
    AllButDefault,
    Null,
}

#[derive(Copy, Clone)]
pub enum ExportExportName<'a> {
    Name(NameSpan<'a>),
    /// The `default` of `export default ..`.
    Default(Span),
    /// `export * from "m"`
    Null,
}

impl ExportExportName<'_> {
    fn default_export_span(&self) -> Option<Span> {
        match self {
            ExportExportName::Default(span) => Some(*span),
            ExportExportName::Name(name) if name.name.is("default") => Some(name.span),
            _ => None,
        }
    }
}

#[derive(Copy, Clone)]
pub struct ExportEntry<'a> {
    /// Of an `export { a }` of what is imported: the `import`.
    pub statement_span: Span,
    /// The specifier, the declaration without its `export`, or the whole of an `export *`.
    pub span: Span,
    pub module_request: Option<NameSpan<'a>>,
    pub import_name: ExportImportName<'a>,
    pub export_name: ExportExportName<'a>,
    pub is_type: bool,
}

/// A statement that names a module.
#[derive(Copy, Clone)]
pub struct RequestedModule {
    pub statement_span: Span,
    /// The specifier.
    pub span: Span,
    /// `import type`, `export type`
    pub is_type: bool,
    pub is_import: bool,
}

pub struct ModuleRecord<'a> {
    pub import_entries: Vec<ImportEntry<'a>>,
    pub local_export_entries: Vec<ExportEntry<'a>>,
    pub indirect_export_entries: Vec<ExportEntry<'a>>,
    pub star_export_entries: Vec<ExportEntry<'a>>,
    /// Where each name is exported, the last time.
    pub exported_bindings: FxHashMap<Name<'a>, Span>,
}

pub fn module_request(declaration: Import<'_>) -> NameSpan<'_> {
    NameSpan {
        name: declaration.spec(),
        span: declaration.spec_span().unwrap_or_default(),
    }
}

/// `ModuleRecord::requested_modules`: by specifier, in the order in which they are first named.
pub fn requested_modules<'a>(
    file: &'a File<'a>,
) -> Vec<(Name<'a>, SmallVec<[RequestedModule; 1]>)> {
    let mut all: Vec<(Name<'a>, SmallVec<[RequestedModule; 1]>)> = Vec::new();
    let mut positions: FxHashMap<Name<'a>, usize> = FxHashMap::default();
    for stmt in file.body() {
        let (name, is_type) = match stmt.kind() {
            StmtKind::Import(import) => (Some(import.spec()), import.is_type_only()),
            StmtKind::ExportNamed(export) => (
                export.spec().filter(|_| export.has_from()),
                export.is_type_only(),
            ),
            StmtKind::ExportStar {
                spec, type_only, ..
            } => (spec, type_only),
            _ => continue,
        };
        let (Some(name), Some(span)) = (name, stmt.module_specifier_span()) else {
            continue;
        };
        let at = *positions.entry(name).or_insert_with(|| {
            all.push((name, SmallVec::new()));
            all.len() - 1
        });
        if let Some((_, requests)) = all.get_mut(at) {
            requests.push(RequestedModule {
                statement_span: stmt.span(),
                span,
                is_type,
                is_import: stmt.tag() == StmtTag::Import,
            });
        }
    }
    all
}

/// `hash_bytes` of `rustc-hash` 2, on a 64-bit machine.
fn hash_bytes(bytes: &[u8]) -> u64 {
    let multiply_mix = |x: u64, y: u64| {
        let full = u128::from(x) * u128::from(y);
        full as u64 ^ (full >> 64) as u64
    };
    let first = |bytes: &[u8]| {
        bytes
            .first_chunk::<8>()
            .map_or(0, |it| u64::from_le_bytes(*it))
    };
    let last = |bytes: &[u8]| {
        bytes
            .last_chunk::<8>()
            .map_or(0, |it| u64::from_le_bytes(*it))
    };
    let (mut s0, mut s1) = (0x243f_6a88_85a3_08d3_u64, 0x1319_8a2e_0370_7344_u64);
    match bytes.len() {
        0 => {}
        len @ 1..4 => {
            let at = |at: usize| bytes.get(at).map_or(0, |it| u64::from(*it));
            s0 ^= at(0);
            s1 ^= at(len - 1) << 8 | at(len / 2);
        }
        4..8 => {
            s0 ^= bytes
                .first_chunk::<4>()
                .map_or(0, |it| u64::from(u32::from_le_bytes(*it)));
            s1 ^= bytes
                .last_chunk::<4>()
                .map_or(0, |it| u64::from(u32::from_le_bytes(*it)));
        }
        8..=16 => {
            s0 ^= first(bytes);
            s1 ^= last(bytes);
        }
        len => {
            let mut bulk = bytes.get(..len - 1).unwrap_or_default();
            while let Some((chunk, rest)) = bulk.split_first_chunk::<16>() {
                (s0, s1) = (
                    s1,
                    multiply_mix(s0 ^ first(chunk), 0xa409_3822_299f_31d0 ^ last(chunk)),
                );
                bulk = rest;
            }
            let suffix = bytes.last_chunk::<16>().map_or(bytes, |it| it.as_slice());
            s0 ^= first(suffix);
            s1 ^= last(suffix);
        }
    }
    multiply_mix(s0, s1) ^ bytes.len() as u64
}

/// What `FxHasher` makes of a string.
fn hash_of_str(text: &[u8]) -> usize {
    let add_to_hash = |hash: u64, i: u64| hash.wrapping_add(i).wrapping_mul(0xf135_7aea_2e62_a9c5);
    add_to_hash(add_to_hash(0, hash_bytes(text)), 0xff).rotate_left(26) as usize
}

/// A table of `hashbrown` with room for `capacity` entries.
fn hash_table(capacity: usize) -> Vec<Option<(usize, usize)>> {
    let buckets = match capacity {
        ..4 => 4,
        4..8 => 8,
        _ => (capacity * 8 / 7).next_power_of_two(),
    };
    vec![None; buckets]
}

/// Puts an entry, which is its hash and a number, in the first free place from where its hash says. `hashbrown` looks at 16 places
/// at a time, which comes to the same unless that many are taken in a row.
fn insert_in_hash_table(table: &mut [Option<(usize, usize)>], entry: (usize, usize)) {
    let (before, after) = table.split_at_mut(entry.0 & table.len().saturating_sub(1));
    if let Some(free) = after.iter_mut().chain(before).find(|it| it.is_none()) {
        *free = Some(entry);
    }
}

/// `requested`, which is in the order of the source, in the order in which oxlint goes through its `requested_modules`. That is a
/// `FxHashMap` which is collected from the `FxHashMap` to which the parser adds one specifier after the other.
pub fn in_hash_order<'a, T>(requested: Vec<(Name<'a>, T)>) -> Vec<(Name<'a>, T)> {
    let mut of_parser: Vec<Option<(usize, usize)>> = Vec::new();
    for (count, (name, _)) in requested.iter().enumerate() {
        let capacity = match of_parser.len() {
            buckets @ ..8 => buckets.saturating_sub(1),
            buckets => buckets / 8 * 7,
        };
        if count == capacity {
            let mut grown = hash_table(capacity + 1);
            of_parser
                .iter()
                .flatten()
                .for_each(|it| insert_in_hash_table(&mut grown, *it));
            of_parser = grown;
        }
        insert_in_hash_table(&mut of_parser, (hash_of_str(name.bytes()), count));
    }
    let mut collected = hash_table(requested.len());
    of_parser
        .iter()
        .flatten()
        .for_each(|it| insert_in_hash_table(&mut collected, *it));
    let mut requested: Vec<Option<(Name<'a>, T)>> = requested.into_iter().map(Some).collect();
    collected
        .iter()
        .flatten()
        .filter_map(|it| requested.get_mut(it.1)?.take())
        .collect()
}

impl<'a> ModuleRecord<'a> {
    pub fn new(file: &'a File<'a>) -> Self {
        let mut record = ModuleRecord {
            import_entries: import_entries(file).collect(),
            local_export_entries: Vec::new(),
            indirect_export_entries: Vec::new(),
            star_export_entries: Vec::new(),
            exported_bindings: FxHashMap::default(),
        };
        // The first import of each name.
        let mut imported: FxHashMap<Name<'a>, ImportEntry<'a>> = FxHashMap::default();
        for entry in record.import_entries.iter().rev() {
            imported.insert(entry.local_name().name(), *entry);
        }
        for stmt in file.body() {
            record.add_exports_of(stmt, &imported);
        }
        record
    }

    fn add_exports_of(&mut self, stmt: Stmt<'a>, imported: &FxHashMap<Name<'a>, ImportEntry<'a>>) {
        let local = |span: Span, export_name: ExportExportName<'a>, is_type: bool| ExportEntry {
            statement_span: export_declaration_span(stmt),
            span,
            module_request: None,
            import_name: ExportImportName::Null,
            export_name,
            is_type,
        };
        let source = |name: Option<Name<'a>>| {
            Some(NameSpan {
                name: name?,
                span: stmt.module_specifier_span()?,
            })
        };
        match stmt.kind() {
            StmtKind::ExportStar {
                spec,
                alias,
                type_only,
            } => {
                let alias = alias.map(NameSpan::from);
                let entry = ExportEntry {
                    module_request: source(spec),
                    import_name: if alias.is_some() {
                        ExportImportName::All
                    } else {
                        ExportImportName::AllButDefault
                    },
                    ..local(
                        stmt.span(),
                        alias.map_or(ExportExportName::Null, ExportExportName::Name),
                        type_only,
                    )
                };
                match alias {
                    Some(alias) => {
                        self.exported_bindings.insert(alias.name, alias.span);
                        self.indirect_export_entries.push(entry);
                    }
                    None => self.star_export_entries.push(entry),
                }
            }
            StmtKind::ExportDefault(e) => {
                self.local_export_entries.push(local(
                    e.outer_span(),
                    ExportExportName::Default(default_keyword_span(stmt)),
                    false,
                ));
            }
            StmtKind::ExportNamed(export) => {
                let module_request = source(export.spec().filter(|_| export.has_from()));
                for specifier in export.items() {
                    let (exported, name) = (
                        NameSpan::from(specifier.exported()),
                        NameSpan::from(specifier.local()),
                    );
                    self.exported_bindings.insert(exported.name, exported.span);
                    let is_type = specifier.is_type_only() || export.is_type_only();
                    let entry = local(specifier.span(), ExportExportName::Name(exported), is_type);
                    if module_request.is_some() {
                        self.indirect_export_entries.push(ExportEntry {
                            module_request,
                            import_name: ExportImportName::Name(name),
                            ..entry
                        });
                        continue;
                    }
                    let import_name =
                        imported
                            .get(&name.name)
                            .and_then(|it| match it.import_name {
                                ImportImportName::Name(imported) => {
                                    Some((it, NameSpan::from(imported.imported())))
                                }
                                // As the parser has it: the name here, not `default`.
                                ImportImportName::Default(local) => {
                                    Some((it, NameSpan::from(local)))
                                }
                                ImportImportName::NamespaceObject(_) => None,
                            });
                    match import_name {
                        Some((import, import_name)) => {
                            self.indirect_export_entries.push(ExportEntry {
                                statement_span: import.declaration.stmt().span(),
                                module_request: Some(module_request_of(import)),
                                import_name: ExportImportName::Name(import_name),
                                is_type: import.is_type(),
                                ..entry
                            })
                        }
                        None => self.local_export_entries.push(entry),
                    }
                }
            }
            kind if stmt.is_default_export() => {
                let is_type = match kind {
                    StmtKind::Fn(func) => !func.has_body() || stmt.flags().contains(Flags::AMBIENT),
                    StmtKind::Class(_) => stmt.flags().intersects(Flags::AMBIENT | Flags::ABSTRACT),
                    _ => true,
                };
                let export_name = ExportExportName::Default(default_keyword_span(stmt));
                self.local_export_entries.push(local(
                    stmt.span_without_export(),
                    export_name,
                    is_type,
                ));
            }
            kind if is_export_declaration(stmt) => {
                let (span, is_type) =
                    (stmt.span_without_export(), is_type_export_declaration(stmt));
                let mut add = |name: NameSpan<'a>| {
                    self.exported_bindings.insert(name.name, name.span);
                    self.local_export_entries.push(local(
                        span,
                        ExportExportName::Name(name),
                        is_type,
                    ));
                };
                let id = match kind {
                    StmtKind::Var(declarators) => {
                        for declarator in declarators {
                            declarator.pat().for_each_binding(&mut |id| {
                                if let Some(name) = id.as_ident() {
                                    add(NameSpan {
                                        name,
                                        span: id.span(),
                                    });
                                }
                            });
                        }
                        None
                    }
                    StmtKind::Fn(func) => func.name(),
                    StmtKind::Class(class) => class.name(),
                    StmtKind::TypeAlias(alias) => Some(alias.name()),
                    StmtKind::Interface(interface) => Some(interface.name()),
                    StmtKind::Enum(declaration) => Some(declaration.name()),
                    StmtKind::ImportEquals(import) => Some(import.name()),
                    StmtKind::Module(module) => match module.name() {
                        ModuleName::Ident(name) => Some(name),
                        ModuleName::String(_) | ModuleName::Global => None,
                    },
                    _ => None,
                };
                if let Some(id) = id {
                    add(id.into());
                }
            }
            _ => {}
        }
    }

    /// The `default` of the first `export default ..` or `export { a as default }`. If there is none, of the first that exports what
    /// another module has.
    pub fn export_default(&self) -> Option<Span> {
        let entries = self
            .local_export_entries
            .iter()
            .chain(&self.indirect_export_entries);
        entries
            .map(|it| it.export_name)
            .find_map(|it| it.default_export_span())
    }

    /// What the rules read of it when another file is linted.
    fn to_remote(&self, file: &'a File<'a>) -> Record {
        let owned = |name: Name<'a>| Box::<[u8]>::from(name.bytes());
        let mut exported_bindings: Vec<Box<[u8]>> =
            self.exported_bindings.keys().map(|it| owned(*it)).collect();
        exported_bindings.sort_unstable();
        Record {
            has_module_syntax: has_module_syntax(file),
            has_export_default: self.export_default().is_some(),
            exported_bindings: exported_bindings.into_boxed_slice(),
            import_entries: (self.import_entries.iter())
                .map(|it| modules::ImportEntry {
                    module_request: owned(it.declaration.spec()),
                    import_name: match it.import_name {
                        ImportImportName::Name(specifier) => {
                            modules::ImportName::Name(owned(specifier.imported().name()))
                        }
                        ImportImportName::NamespaceObject(_) => {
                            modules::ImportName::NamespaceObject
                        }
                        ImportImportName::Default(_) => modules::ImportName::Default,
                    },
                    local_name: owned(it.local_name().name()),
                })
                .collect(),
            indirect_export_entries: (self.indirect_export_entries.iter())
                .filter_map(|it| {
                    Some(modules::IndirectExportEntry {
                        module_request: owned(it.module_request?.name),
                        import_name: match it.import_name {
                            ExportImportName::Name(name) => Some(owned(name.name)),
                            _ => None,
                        },
                        export_name: match it.export_name {
                            ExportExportName::Name(name) => owned(name.name),
                            _ => return None,
                        },
                    })
                })
                .collect(),
            star_export_entries: self
                .star_export_entries
                .iter()
                .filter_map(|it| Some(owned(it.module_request?.name)))
                .collect(),
        }
    }
}

fn module_request_of<'a>(entry: &ImportEntry<'a>) -> NameSpan<'a> {
    module_request(entry.declaration)
}

/// The resolver of oxlint leaves a query and a fragment out: `./a?raw` and `./a#b` are `./a`. A `#` that no query is before can also
/// be part of the name of a file: that is tried first, then what is second here.
fn paths_of(specifier: &[u8]) -> (&[u8], Option<&[u8]>) {
    match strings::index_of_any(specifier.get(1..).unwrap_or_default(), b"?#").map(|at| at + 1) {
        Some(at) if specifier.get(at) == Some(&b'#') => (specifier, specifier.get(..at)),
        Some(at) => (specifier.get(..at).unwrap_or(specifier), None),
        None => (specifier, None),
    }
}

/// What a rule that asks about other files starts with. While they are not all known, it says what the file exports and names, and
/// has it linted again if it names a module: `true`, and there is nothing to report yet.
pub fn is_waiting_for_modules<'a>(file: &'a File<'a>) -> bool {
    let Some(modules) = file.modules().filter(|it| !it.is_complete()) else {
        return false;
    };
    modules.record_exports(file, |file| ModuleRecord::new(file).to_remote(file));
    let mut requests = requests_of(file, Flavor::Oxlint);
    let mut without_fragment = Vec::new();
    for request in &mut requests {
        let (first, second) = paths_of(request.specifier);
        request.specifier = first;
        without_fragment.extend(second.map(|specifier| modules::Request {
            specifier,
            ..*request
        }));
    }
    requests.append(&mut without_fragment);
    if !requests.is_empty() {
        modules.record(file.path(), &requests, true, Flavor::Oxlint);
    }
    !requests.is_empty()
}

/// Another file, and what is known of it.
#[derive(Copy, Clone)]
pub struct Loaded<'m> {
    pub modules: &'m dyn Modules,
    pub module: ModuleId,
    pub record: &'m Record,
}

/// `module_record.get_loaded_module(specifier)` of the file that is linted. `specifier` has to be one that an `import` or an
/// `export .. from` of it has. `None` if there is no such file, if it is not JavaScript or TypeScript, or if it cannot be parsed.
pub fn get_loaded_module<'a>(file: &'a File<'a>, specifier: &[u8]) -> Option<Loaded<'a>> {
    load(file.modules()?, file.path(), specifier)
}

fn load<'m>(modules: &'m dyn Modules, from: &[u8], specifier: &[u8]) -> Option<Loaded<'m>> {
    let (first, second) = paths_of(specifier);
    let module = modules
        .resolve(from, first, false)
        .or_else(|| modules.resolve(from, second?, false))?
        .module;
    Some(Loaded {
        modules,
        module,
        record: modules.record_of(module)?,
    })
}

impl<'m> Loaded<'m> {
    /// `resolved_absolute_path`
    pub fn path(&self) -> &'m [u8] {
        self.modules.path(self.module)
    }

    pub fn get_loaded_module(&self, specifier: &[u8]) -> Option<Loaded<'m>> {
        load(self.modules, self.path(), specifier)
    }

    /// `exported_bindings.contains_key(name)`
    pub fn exports(&self, name: &[u8]) -> bool {
        self.record
            .exported_bindings
            .binary_search_by(|it| (**it).cmp(name))
            .is_ok()
    }
}

/// `exported_bindings_from_star_export()` of the modules that were asked about: the names that each gets by `export * from`, directly
/// or not.
#[derive(Default)]
pub struct StarExports<'m>(FxHashMap<ModuleId, FxHashSet<&'m [u8]>>);

impl<'m> StarExports<'m> {
    pub fn contains(&mut self, module: Loaded<'m>, name: &[u8]) -> bool {
        if module.record.star_export_entries.is_empty() {
            return false;
        }
        let names = self.0.entry(module.module).or_insert_with(|| {
            let (mut names, mut visited) =
                (FxHashSet::default(), FxHashSet::from_iter([module.module]));
            let mut pending = vec![module];
            while let Some(at) = pending.pop() {
                for remote in at
                    .record
                    .star_export_entries
                    .iter()
                    .filter_map(|it| at.get_loaded_module(it))
                {
                    if visited.insert(remote.module) {
                        names.extend(remote.record.exported_bindings.iter().map(|it| &**it));
                        pending.push(remote);
                    }
                }
            }
            names
        });
        names.contains(name)
    }
}

/// `{name:?}` in a message: in double quotes, as Rust writes a string.
pub fn debug(name: &[u8]) -> String {
    let characters = |it: std::str::Utf8Chunk<'_>| {
        let invalid = (!it.invalid().is_empty()).then_some(char::REPLACEMENT_CHARACTER);
        it.valid().chars().chain(invalid).collect::<Vec<char>>()
    };
    format!(
        "{:?}",
        name.utf8_chunks().flat_map(characters).collect::<String>()
    )
}
