use super::coerce::Ty;
use super::{FileBuild, Fx, Place};
use crate::fragment::GlobalKey;
use crate::id::{GlobalId, V};
use crate::ir::Op;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Decl, Parent, SymFlags};
use bun_sema::hir::{self, FileKind, StmtKind};
use bun_sema::program::{FileId, Files, Sym};
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

#[derive(Copy, Clone)]
pub(crate) enum HostAssetKind {
    Addon,
    Database,
    Manifest,
    OfType(Atom),
}

#[derive(Copy, Clone)]
enum Star {
    Module(FileId),
    Object(FileId),
    Outside(Atom),
}

#[derive(Default)]
pub(crate) struct Stars {
    list: Vec<Star>,
    by_name: FxHashMap<Atom, Vec<u32>>,
    wildcard_stars: Vec<u32>,
}

impl Stars {
    fn candidates_for(&self, name: Atom) -> Vec<Star> {
        let mut indices: Vec<u32> = self
            .by_name
            .get(&name)
            .into_iter()
            .flatten()
            .chain(&self.wildcard_stars)
            .copied()
            .collect();
        indices.sort_unstable();
        indices
            .into_iter()
            .map(|index| self.list[index as usize])
            .collect()
    }
}

#[derive(Copy, Clone)]
pub(crate) enum ImportSource {
    Declaration(Sym),
    Namespace(FileId),
    DeferredNamespace(FileId),
    Entity(Sym),
    ExportedObject {
        importer: FileId,
        file: FileId,
        name: Option<Atom>,
    },
    External {
        specifier: Atom,
        name: Option<Atom>,
    },
    Text {
        file: FileId,
        specifier: Atom,
    },
    Required(FileId),
    Unknown,
}

#[derive(Copy, Clone)]
pub(crate) enum EntityAlias {
    TypeOnly,
    SameBinding(Sym),
    CopiedValue,
}

struct ResolvedAliasPath {
    source: Option<ImportSource>,
    names: Vec<Atom>,
    resolved_count: usize,
    crossed_aliases: Vec<Sym>,
}

pub(crate) fn is_builtin_specifier(specifier: &[u8]) -> bool {
    specifier == b"bun"
        || specifier.starts_with(b"bun:")
        || specifier.starts_with(b"node:")
        || known_builtin_exports(specifier).is_some()
}

fn known_builtin_exports(specifier: &[u8]) -> Option<(&'static [u8], &'static [&'static [u8]])> {
    static TABLE: std::sync::OnceLock<Vec<(&'static [u8], Vec<&'static [u8]>)>> =
        std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let lines = include_str!("../builtin-export-names.txt").lines();
        lines
            .filter_map(|line| line.split_once(' '))
            .map(|(module, names)| {
                (
                    module.as_bytes(),
                    names.split(' ').map(str::as_bytes).collect(),
                )
            })
            .collect()
    });
    let find = |name: &[u8]| table.binary_search_by_key(&name, |module| module.0).ok();
    let found = find(specifier).or_else(|| find(&[&b"node:"[..], specifier].concat()))?;
    Some((table[found].0, table[found].1.as_slice()))
}

pub(crate) fn original_source_of(files: &Files<'_>, code: FileId) -> FileId {
    let written = files
        .module(code)
        .file_name()
        .strip_suffix(b".js")
        .and_then(|written| files.by_path.get(written));
    written
        .filter(|&written| files.lowers_decorators(written))
        .unwrap_or(code)
}

pub(crate) struct Bundle<'p> {
    resolved: FxHashMap<(FileId, &'p [u8]), (&'p [u8], Option<FileId>)>,
    pub(super) dropped: FxHashSet<(FileId, &'p [u8])>,
    declaring: FxHashSet<FileId>,
    has_require_specific_resolutions: bool,
}

impl<'p> Bundle<'p> {
    pub(crate) fn new(
        files: &Files<'_>,
        roots: &[FileId],
        constants: &'p crate::Constants,
    ) -> Option<Bundle<'p>> {
        let mut resolved: FxHashMap<(FileId, &'p [u8]), (&'p [u8], Option<FileId>)> =
            FxHashMap::default();
        let imports = constants.resolved.as_ref()?;
        let files_by_path_list: Vec<Option<FileId>> = imports
            .paths()
            .iter()
            .map(|path| files.by_path.get(path))
            .collect();
        let found_at: Vec<(&'p [u8], Option<FileId>)> =
            (imports.paths().iter().zip(&files_by_path_list))
                .map(|(to, &printed)| {
                    let code = printed.map(|printed| original_source_of(files, printed));
                    (
                        if code == printed {
                            to.as_slice()
                        } else {
                            &to[..to.len() - b".js".len()]
                        },
                        code,
                    )
                })
                .collect();
        for (from, specifier, to) in imports.by_number() {
            let Some(from) = files_by_path_list[from as usize] else {
                continue;
            };
            let found = found_at[to as usize];
            let known = resolved.entry((from, specifier)).or_insert(found);
            if found.0 < known.0 {
                *known = found;
            }
        }
        let dropped = (constants.dropped_imports.iter())
            .filter_map(|(from, specifier)| Some((files.by_path.get(from)?, specifier.as_slice())))
            .collect();
        let has_require_specific_resolutions = resolved
            .keys()
            .any(|key| key.1.starts_with(crate::REQUIRE_SPECIFIER_PREFIX));
        let mut bundle = Bundle {
            resolved,
            dropped,
            declaring: FxHashSet::default(),
            has_require_specific_resolutions,
        };
        bundle.declaring = bundle.declaration_only_files(files, roots);
        Some(bundle)
    }

    pub(crate) fn require_specific_resolutions(
        &self,
    ) -> impl Iterator<Item = (FileId, &'p [u8], FileId)> + '_ {
        let marked = self
            .resolved
            .iter()
            .filter(|_| self.has_require_specific_resolutions);
        marked.filter_map(|(&(from, specifier), &(_, to))| {
            Some((
                from,
                specifier.strip_prefix(crate::REQUIRE_SPECIFIER_PREFIX)?,
                to?,
            ))
        })
    }

    pub(crate) fn declaring(&self) -> impl Iterator<Item = FileId> + '_ {
        self.declaring.iter().copied()
    }

    fn declaration_only_files(&self, files: &Files<'_>, roots: &[FileId]) -> FxHashSet<FileId> {
        let mut compiled: FxHashSet<FileId> = roots.iter().copied().collect();
        compiled.extend(self.resolved.values().filter_map(|found| found.1));
        let mut pending: Vec<FileId> = Vec::new();
        for (&(from, specifier), &(_, code)) in &self.resolved {
            let typed_by = files
                .atoms
                .lookup(specifier)
                .and_then(|specifier| files.module(from).imported_file(specifier));
            pending.extend(typed_by.filter(|&typed_by| Some(typed_by) != code));
        }
        for &file in &compiled {
            pending.extend(
                files
                    .module(file)
                    .file_name()
                    .strip_suffix(b".js")
                    .and_then(|written| files.by_path.get(written)),
            );
            let hir = files.hir(file);
            for stmt in hir.ids(hir.body) {
                let specifier = match hir[stmt].kind {
                    StmtKind::Import(import) if !hir[import].type_only => hir[import].spec,
                    StmtKind::ExportNamed(export) if !hir[export].type_only => hir[export].spec,
                    StmtKind::ExportStar {
                        spec,
                        type_only: false,
                        ..
                    } => spec,
                    _ => continue,
                };
                if specifier.is_none() || is_type_only_statement(hir, stmt) {
                    continue;
                }
                let key = (file, files.atoms.bytes(specifier));
                if !self.resolved.contains_key(&key) && !self.dropped.contains(&key) {
                    pending.extend(files.module(file).imported_file(specifier));
                }
            }
        }
        let mut declaring = FxHashSet::default();
        while let Some(file) = pending.pop() {
            if !compiled.contains(&file) && declaring.insert(file) {
                pending.extend(files.module(file).edges);
            }
        }
        declaring
    }
}

pub(crate) fn is_type_only_statement(hir: &hir::File<'_>, stmt: hir::StmtId) -> bool {
    match hir[stmt].kind {
        StmtKind::Import(import) => {
            let import = &hir[import];
            import.default.is_none()
                && import.namespace.is_none()
                && !import.named.is_empty()
                && import.named.iter().all(|name| hir[name].type_only)
        }
        StmtKind::ExportNamed(export) => {
            !hir[export].items.is_empty()
                && hir[export].items.iter().all(|name| hir[name].type_only)
        }
        _ => false,
    }
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn required_again_form(&self, file: FileId) -> Option<FileId> {
        self.shared
            .bundle
            .as_ref()?
            .resolved
            .get(&(file, crate::REQUIRED_AGAIN_SPECIFIER))?
            .1
            .filter(|_| self.is_commonjs(file))
    }

    pub(crate) fn is_required_again_form(&self, file: FileId) -> bool {
        self.files
            .module(file)
            .file_name()
            .ends_with(crate::REQUIRED_AGAIN_SUFFIX)
    }

    pub(crate) fn is_resolved_by_bundler(&self, file: FileId, specifier: Atom) -> bool {
        self.shared.bundle.as_ref().is_some_and(|bundle| {
            bundle
                .resolved
                .contains_key(&(file, self.c.atoms().bytes(specifier)))
        })
    }

    pub(crate) fn is_declaration_only(&self, file: FileId) -> bool {
        self.hir(file).kind == FileKind::Declaration
            || self
                .shared
                .bundle
                .as_ref()
                .is_some_and(|bundle| bundle.declaring.contains(&file))
    }

    pub(crate) fn imported_file(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        if specifier.is_none() {
            return None;
        }
        if self.is_builtin_file(file) {
            let id = self.required_builtin_id(file, specifier)?;
            let modules = self.shared.builtin_modules();
            return modules
                .binary_search_by_key(&id, |module| module.0)
                .ok()
                .map(|found| modules[found].1);
        }
        let text = self.c.atoms().bytes(specifier);
        if text == b"bun:wrap" {
            return self.shared.runtime_helpers();
        }
        let imported = match &self.shared.bundle {
            Some(bundle) => bundle.resolved.get(&(file, text))?.1?,
            None => self.checker_resolved_file(file, specifier)?,
        };
        (!self.is_declaration_only(imported)).then_some(imported)
    }

    pub(crate) fn required_file(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        if let Some(bundle) = self
            .shared
            .bundle
            .as_ref()
            .filter(|bundle| bundle.has_require_specific_resolutions && specifier.is_some())
        {
            let marked = [
                crate::REQUIRE_SPECIFIER_PREFIX,
                self.c.atoms().bytes(specifier),
            ]
            .concat();
            if let Some(found) = bundle.resolved.get(&(file, marked.as_slice())) {
                return found
                    .1
                    .filter(|&required| !self.is_declaration_only(required));
            }
        }
        self.imported_file(file, specifier)
    }

    fn report_unknown_runtime_helpers(&mut self, file: FileId) -> bool {
        let Some(helpers) = self.shared.runtime_helpers() else {
            return false;
        };
        let hir = self.hir(file);
        let from_runtime = hir
            .imports
            .iter()
            .filter(|import| !import.type_only && self.c.atoms().bytes(import.spec) == b"bun:wrap");
        let named: Vec<(u32, Atom)> = from_runtime
            .flat_map(|import| import.named.iter().map(|spec| &hir[spec]))
            .filter(|spec| !spec.type_only)
            .map(|spec| (spec.imported_pos, spec.imported))
            .collect();
        let mut is_any_unknown = false;
        for (pos, name) in named {
            if self.exported_binding(helpers, name).is_some() {
                continue;
            }
            is_any_unknown = true;
            if !self
                .problems
                .iter()
                .any(|problem| problem.file == file && problem.pos == pos)
            {
                let what = format!(
                    "the helper `{}`, which \"bun:wrap\" does not export",
                    bstr::BStr::new(self.c.atoms().bytes(name))
                );
                self.problems.push(super::Problem {
                    file,
                    pos,
                    what: std::borrow::Cow::Owned(what),
                });
            }
        }
        is_any_unknown
    }

    fn checker_resolved_file(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        let module = self.files.module(file);
        if let Some(imported) = module.imported_file(specifier) {
            return Some(imported);
        }
        let text = self.c.atoms().bytes(specifier);
        if !text.starts_with(b"./") && !text.starts_with(b"../") {
            return None;
        }
        let directory = module.file_name().rsplitn(2, |&byte| byte == b'/').nth(1)?;
        self.files
            .by_path
            .get(&bun_sema::resolve::join(directory, text))
    }

    pub(crate) fn host_resolved_specifier(&self, file: FileId, specifier: Atom) -> Atom {
        let specifier = self.host_specifier(specifier);
        let text = self.c.atoms().bytes(specifier);
        match self.import_meta_path_constant(file, b"dir") {
            Some(directory) if text.starts_with(b"./") || text.starts_with(b"../") => self
                .c
                .atoms()
                .intern(&[&directory[..], b"/", text].concat()),
            _ => specifier,
        }
    }

    pub(crate) fn host_specifier(&self, specifier: Atom) -> Atom {
        match self.c.atoms().bytes(specifier) {
            b"vitest" | b"@jest/globals" if self.shared.constants.has_test_globals => {
                self.c.atoms().intern(b"bun:test")
            }
            _ => specifier,
        }
    }

    pub(crate) fn imported_text(&self, file: FileId, specifier: Atom) -> Option<&'c [u8]> {
        if specifier.is_none() {
            return None;
        }
        let path = self
            .shared
            .bundle
            .as_ref()?
            .resolved
            .get(&(file, self.c.atoms().bytes(specifier)))?
            .0;
        self.shared
            .constants
            .assets
            .get(path)
            .or_else(|| self.shared.constants.texts.get(path))
            .map(Vec::as_slice)
    }

    pub(crate) fn import_attribute_type(&self, file: FileId, specifier: Atom) -> Option<Atom> {
        let hir = self.hir(file);
        if specifier.is_none()
            || hir.import_attributes.is_empty()
            || self.shared.constants.source_path_to_url.is_none()
            || self.shared.bundle.is_none()
        {
            return None;
        }
        if self.imported_text(file, specifier).is_some()
            || self.imported_file(file, specifier).is_some()
        {
            return None;
        }
        hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) if hir[import].spec == specifier => {
                self.type_attribute(file, stmt)
            }
            _ => None,
        })
    }

    pub(crate) fn is_imported_with_other_type(
        &self,
        file: FileId,
        specifier: Atom,
        said: Option<Atom>,
    ) -> bool {
        self.reachable_import_types(file, specifier)
            .iter()
            .any(|&(_, says)| says != said)
    }

    pub(crate) fn is_statically_imported_with_type(
        &self,
        file: FileId,
        specifier: Atom,
        said: Atom,
    ) -> bool {
        self.reachable_import_types(file, specifier)
            .contains(&(true, Some(said)))
    }

    pub(crate) fn import_options_type(
        &self,
        file: FileId,
        options: Option<hir::ExprId>,
    ) -> Option<Atom> {
        let hir = self.hir(file);
        let member = |object: Option<hir::ExprId>, name: &[u8]| match hir[object?].kind {
            hir::ExprKind::Object(props) => props.iter().find_map(|p| match hir[p].key {
                hir::PropKey::Name(key) if self.c.atoms().bytes(key) == name => Some(hir[p].value),
                _ => None,
            }),
            _ => None,
        };
        match member(member(options, b"with"), b"type").map(|value| hir[value].kind) {
            Some(hir::ExprKind::String(value)) => Some(value),
            _ => None,
        }
    }

    fn reachable_import_types(&self, file: FileId, specifier: Atom) -> Vec<(bool, Option<Atom>)> {
        let without_dots = |path: &[u8]| {
            let mut parts: Vec<&[u8]> = Vec::new();
            for part in bun_core::strings::split(path, b"/") {
                match part {
                    b"." => {}
                    b".." => {
                        parts.pop();
                    }
                    _ => parts.push(part),
                }
            }
            parts.join(&b"/"[..])
        };
        let requested = without_dots(
            self.c
                .atoms()
                .bytes(self.host_resolved_specifier(file, specifier)),
        );
        let mut found = Vec::new();
        for &module in &self.shared.modules {
            let hir = self.hir(module);
            for used in hir.specifier_uses.iter() {
                if used.kind == hir::SpecifierKind::ImportType
                    || without_dots(
                        self.c
                            .atoms()
                            .bytes(self.host_resolved_specifier(module, used.spec)),
                    ) != requested
                {
                    continue;
                }
                found.push(match used.kind {
                    hir::SpecifierKind::Import | hir::SpecifierKind::SideEffect => {
                        let statement = hir.ids(hir.body).find(|&stmt| {
                            hir[stmt].start <= used.pos && used.pos < hir[stmt].loc.end
                        });
                        (
                            true,
                            statement.and_then(|stmt| self.type_attribute(module, stmt)),
                        )
                    }
                    hir::SpecifierKind::ImportCall => {
                        let options = hir.exprs.iter().find_map(|e| match e.kind {
                            hir::ExprKind::ImportCall { args }
                                if hir[hir.id_at(args, 0)].pos == used.pos =>
                            {
                                hir.ids(args).nth(1)
                            }
                            _ => None,
                        });
                        (false, self.import_options_type(module, options))
                    }
                    _ => (false, None),
                });
            }
        }
        found
    }

    pub(crate) fn host_loaded_asset(&self, file: FileId, specifier: Atom) -> Option<HostAssetKind> {
        if let Some(said) = self.import_attribute_type(file, specifier) {
            return Some(HostAssetKind::OfType(said));
        }
        let path = self
            .shared
            .bundle
            .as_ref()?
            .resolved
            .get(&(file, self.c.atoms().bytes(specifier)))?
            .0;
        let covers_it = self.shared.constants.assets.get(path)?;
        if covers_it.len() == 25 && covers_it[16] == b'H' {
            return Some(HostAssetKind::Manifest);
        }
        let hir = self.hir(file);
        let said = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) if hir[import].spec == specifier => {
                self.type_attribute(file, stmt)
            }
            _ => None,
        });
        match said.map(|said| self.c.atoms().bytes(said)) {
            Some(b"napi" | b"node") => Some(HostAssetKind::Addon),
            Some(b"sqlite") => Some(HostAssetKind::Database),
            Some(_) => None,
            None => path.ends_with(b".node").then_some(HostAssetKind::Addon),
        }
    }

    pub(crate) fn is_bundle_only_import(&self, file: FileId, specifier: Atom) -> bool {
        specifier.is_some()
            && self.imported_text(file, specifier).is_none()
            && (self.shared.bundle.as_ref()).is_some_and(|bundle| {
                bundle
                    .resolved
                    .get(&(file, self.c.atoms().bytes(specifier)))
                    .is_some_and(|found| found.1.is_none())
            })
    }

    pub(crate) fn is_dropped_import(&self, file: FileId, specifier: Atom) -> bool {
        specifier.is_some()
            && self.shared.bundle.as_ref().is_some_and(|bundle| {
                bundle
                    .dropped
                    .contains(&(file, self.c.atoms().bytes(specifier)))
            })
    }

    pub(crate) fn jsx_runtime(&self, file: FileId) -> Option<Atom> {
        let runtime = self.files.jsx_runtime(file)?;
        let Some(bundle) = &self.shared.bundle else {
            return Some(runtime);
        };
        let text = self.c.atoms().bytes(runtime);
        if bundle.resolved.contains_key(&(file, text)) {
            return Some(runtime);
        }
        let other = match (
            text.strip_suffix(b"/jsx-runtime"),
            text.strip_suffix(b"/jsx-dev-runtime"),
        ) {
            (Some(package), _) => [package, b"/jsx-dev-runtime"].concat(),
            (None, Some(package)) => [package, b"/jsx-runtime"].concat(),
            (None, None) => return Some(runtime),
        };
        let is_imported = bundle.resolved.contains_key(&(file, other.as_slice()));
        Some(if is_imported {
            self.c.atoms().intern(&other)
        } else {
            runtime
        })
    }

    pub(crate) fn is_import(&self, sym: Sym) -> bool {
        self.files.flags(sym).contains(SymFlags::ALIAS) && self.is_declared_by_import(sym)
    }

    pub(crate) fn value_symbol(&mut self, sym: Sym) -> Sym {
        if !self.files.flags(sym).contains(SymFlags::ALIAS) {
            return self.value_symbol_inner(sym, &mut Vec::new());
        }
        if let Some(&known) = self.value_symbols.get(&sym) {
            return known;
        }
        let found = self.value_symbol_inner(sym, &mut Vec::new());
        self.value_symbols.insert(sym, found);
        found
    }

    pub(crate) fn value_symbol_inner(&mut self, sym: Sym, seen: &mut Vec<Sym>) -> Sym {
        let mut sym = sym;
        if self.is_import(sym) {
            match self.import_source(sym) {
                ImportSource::Declaration(exported) => {
                    return self.export_value_symbol_inner(exported, seen);
                }
                ImportSource::Namespace(file) => return self.files.file_symbol(file),
                ImportSource::Entity(alias) => match self.entity_alias_kind(alias) {
                    EntityAlias::SameBinding(binding) => {
                        seen.push(alias);
                        return binding;
                    }
                    EntityAlias::CopiedValue => return alias,
                    EntityAlias::TypeOnly => {}
                },
                _ => return sym,
            }
            if let Some(target) = self.files.resolve_alias(sym) {
                sym = target;
            }
        }
        self.files.export_symbol_of_value_symbol_if_exported(sym)
    }

    pub(crate) fn export_value_symbol(&mut self, exported: Sym) -> Sym {
        self.export_value_symbol_inner(exported, &mut Vec::new())
    }

    fn export_value_symbol_inner(&mut self, exported: Sym, seen: &mut Vec<Sym>) -> Sym {
        for &(file, decl) in self.files.decls_of(exported).iter() {
            let Decl::ExportExpr(stmt) = decl else {
                continue;
            };
            let StmtKind::ExportDefault(e) = self.hir(file)[stmt].kind else {
                continue;
            };
            if seen.contains(&exported) {
                return exported;
            }
            seen.push(exported);
            return self
                .default_export_binding_inner(file, e, seen)
                .unwrap_or(exported);
        }
        if self.is_import(exported) {
            return self.value_symbol_inner(exported, seen);
        }
        let mut sym = exported;
        if self.files.flags(sym).contains(SymFlags::ALIAS)
            && let Some(target) = self.files.resolve_alias(sym)
        {
            if self.files.symbol(exported).name == known::export_equals
                && matches!(
                    self.value_declaration(target),
                    Some((_, Decl::Var(_) | Decl::Param(_)))
                )
            {
                return exported;
            }
            sym = target;
        }
        self.files.export_symbol_of_value_symbol_if_exported(sym)
    }

    pub(crate) fn exported_binding(&mut self, file: FileId, name: Atom) -> Option<Sym> {
        match self.export_source(file, name) {
            ImportSource::Declaration(exported) => Some(self.export_value_symbol(exported)),
            ImportSource::Namespace(file) => Some(self.files.file_symbol(file)),
            _ => None,
        }
    }

    pub(crate) fn definitely_lacks_export(&mut self, file: FileId, name: Atom) -> bool {
        if self
            .files
            .export(self.files.file_symbol(file), known::export_equals)
            .is_some()
        {
            return false;
        }
        match self.export_source(file, name) {
            ImportSource::Declaration(exported) => {
                let member = self.export_value_symbol(exported);
                !self.has_value_at_runtime(member)
            }
            ImportSource::Unknown => self.re_exports_only_program_modules(file, &mut vec![file]),
            _ => false,
        }
    }

    pub(crate) fn has_value_at_runtime(&self, member: Sym) -> bool {
        let flags = self.files.flags(member);
        flags.intersects(SymFlags::VALUE) && !self.is_ambient(member)
    }

    fn re_exports_only_program_modules(&self, file: FileId, seen: &mut Vec<FileId>) -> bool {
        self.star_export_specifiers(file)
            .into_iter()
            .all(|specifier| match self.imported_file(file, specifier) {
                Some(imported) if self.has_exports_object(imported) => false,
                Some(imported) if seen.contains(&imported) => true,
                Some(imported) => {
                    seen.push(imported);
                    self.re_exports_only_program_modules(imported, seen)
                }
                None => false,
            })
    }

    pub(crate) fn import_source(&self, alias: Sym) -> ImportSource {
        if let Some(&known) = self.import_sources.borrow().get(&alias) {
            return known;
        }
        self.import_sources
            .borrow_mut()
            .insert(alias, ImportSource::Unknown);
        let source = self.import_source_uncached(alias);
        self.import_sources.borrow_mut().insert(alias, source);
        source
    }

    fn import_source_uncached(&self, alias: Sym) -> ImportSource {
        for &(file, decl) in self.files.decls_of(alias).iter() {
            let hir = self.hir(file);
            let is_deferred =
                matches!(decl, Decl::ImportNamespace(import) if hir[import].is_deferred);
            let (specifier, name) = match decl {
                Decl::ImportDefault(import) => (hir[import].spec, Some(known::default)),
                Decl::ImportNamespace(import) => (hir[import].spec, None),
                Decl::ImportSpec(spec) => (hir[hir[spec].import].spec, Some(hir[spec].imported)),
                Decl::ExportSpec(spec) if hir[hir[spec].export].spec.is_some() => {
                    (hir[hir[spec].export].spec, Some(hir[spec].local))
                }
                Decl::ExportSpec(_) => match self.files.alias_target(alias) {
                    Some(next) if next == alias => return ImportSource::Unknown,
                    Some(next) if self.is_import(next) => return self.import_source(next),
                    Some(next) => return ImportSource::Declaration(next),
                    None => continue,
                },
                Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                    StmtKind::ExportStar { spec, .. } => (spec, None),
                    _ => continue,
                },
                Decl::ImportEquals(import) => match hir[import].target {
                    hir::ImportEqualsTarget::Require(spec) if spec.is_some() => {
                        match self.imported_file(file, spec).filter(|&imported| {
                            !self.has_exports_object(imported)
                                && self.builtin_id(imported).is_none()
                        }) {
                            Some(imported) => {
                                let covers_all = self.c.atoms().intern(b"module.exports");
                                let is_exported = self
                                    .file_exports(imported)
                                    .iter()
                                    .any(|export| export.0 == covers_all);
                                if is_exported
                                    && self
                                        .files
                                        .export(
                                            self.files.file_symbol(imported),
                                            known::export_equals,
                                        )
                                        .is_none()
                                {
                                    return ImportSource::Required(imported);
                                }
                                (spec, is_exported.then_some(covers_all))
                            }
                            None => (spec, Some(known::default)),
                        }
                    }
                    _ => return ImportSource::Entity(alias),
                },
                _ => continue,
            };
            if specifier.is_none() {
                return ImportSource::Unknown;
            }
            if name == Some(known::default) && self.imported_text(file, specifier).is_some() {
                return ImportSource::Text { file, specifier };
            }
            if self.import_attribute_type(file, specifier).is_some() {
                return if name == Some(known::default) {
                    ImportSource::Text { file, specifier }
                } else {
                    ImportSource::Unknown
                };
            }
            if matches!(
                self.host_loaded_asset(file, specifier),
                Some(HostAssetKind::Manifest)
            ) {
                return ImportSource::Unknown;
            }
            let is_asset = match decl {
                Decl::ImportDefault(import) | Decl::ImportNamespace(import) => {
                    self.is_asset_import(file, hir[import].stmt)
                }
                Decl::ImportSpec(spec) => self.is_asset_import(file, hir[hir[spec].import].stmt),
                _ => false,
            };
            let is_asset = is_asset
                && (self.shared.bundle.is_none() || self.imported_text(file, specifier).is_some());
            let Some(imported) = self.imported_file(file, specifier).filter(|_| !is_asset) else {
                return ImportSource::External { specifier, name };
            };
            if self.has_exports_object(imported) {
                return ImportSource::ExportedObject {
                    importer: file,
                    file: imported,
                    name,
                };
            }
            return match name {
                Some(name) => match self.export_source(imported, name) {
                    ImportSource::Unknown if name != known::default => {
                        self.single_object_behind_stars_member(imported, name)
                    }
                    source => source,
                },
                None if is_deferred && self.shared.modules_deferred.contains(&imported) => {
                    ImportSource::DeferredNamespace(imported)
                }
                None => ImportSource::Namespace(imported),
            };
        }
        ImportSource::Unknown
    }

    pub(crate) fn all_star_exports_resolve(&self, file: FileId) -> bool {
        let (mut seen, mut left) = (vec![file], vec![file]);
        while let Some(module) = left.pop() {
            for &star in &self.star_exports(module).list {
                match star {
                    Star::Object(_) | Star::Outside(_) => return false,
                    Star::Module(imported) if seen.contains(&imported) => {}
                    Star::Module(imported) => {
                        seen.push(imported);
                        left.push(imported);
                    }
                }
            }
        }
        true
    }

    pub(crate) fn single_object_behind_stars(&self, file: FileId) -> Option<(FileId, FileId)> {
        let (mut found, mut seen, mut left) = (None, vec![file], vec![file]);
        while let Some(module) = left.pop() {
            for &star in &self.star_exports(module).list {
                match star {
                    Star::Object(object) if found.is_none() => found = Some((module, object)),
                    Star::Object(_) | Star::Outside(_) => return None,
                    Star::Module(imported) if seen.contains(&imported) => {}
                    Star::Module(imported) => {
                        seen.push(imported);
                        left.push(imported);
                    }
                }
            }
        }
        found
    }

    pub(crate) fn single_object_behind_stars_member(
        &self,
        file: FileId,
        name: Atom,
    ) -> ImportSource {
        let (mut found, mut seen, mut left) = (None, vec![file], vec![file]);
        while let Some(module) = left.pop() {
            if self
                .files
                .export(self.files.file_symbol(module), name)
                .is_some()
            {
                return ImportSource::Unknown;
            }
            for &star in &self.star_exports(module).list {
                match star {
                    Star::Object(object) if found.is_none() => found = Some((module, object)),
                    Star::Object(_) | Star::Outside(_) => return ImportSource::Unknown,
                    Star::Module(imported) if seen.contains(&imported) => {}
                    Star::Module(imported) => {
                        seen.push(imported);
                        left.push(imported);
                    }
                }
            }
        }
        found.map_or(ImportSource::Unknown, |(importer, object)| {
            ImportSource::ExportedObject {
                importer,
                file: object,
                name: Some(name),
            }
        })
    }

    fn export_source(&self, file: FileId, name: Atom) -> ImportSource {
        match self.resolve_module_export(file, name, &mut vec![file]) {
            ImportSource::Declaration(exported) if self.is_import(exported) => {
                self.import_source(exported)
            }
            source => source,
        }
    }

    fn resolve_module_export(
        &self,
        file: FileId,
        name: Atom,
        seen: &mut Vec<FileId>,
    ) -> ImportSource {
        if let Some(own) = self.files.export(self.files.file_symbol(file), name) {
            return ImportSource::Declaration(own);
        }
        if (name == known::default || self.c.atoms().bytes(name) == b"module.exports")
            && let Some(assigned) = self
                .files
                .export(self.files.file_symbol(file), known::export_equals)
        {
            return ImportSource::Declaration(assigned);
        }
        if name == known::default {
            return ImportSource::Unknown;
        }
        let has_it = |module: Sym| self.files.module_export(module, name).is_some();
        let mut brought: Option<ImportSource> = None;
        for star in self.star_exports(file).candidates_for(name) {
            match star {
                Star::Object(imported) => {
                    if brought.is_none() && has_it(self.files.file_symbol(imported)) {
                        return ImportSource::ExportedObject {
                            importer: file,
                            file: imported,
                            name: Some(name),
                        };
                    }
                }
                Star::Module(imported) if seen.contains(&imported) => {}
                Star::Module(imported) => {
                    seen.push(imported);
                    let found = self.resolve_module_export(imported, name, seen);
                    match (brought, found) {
                        (_, ImportSource::Unknown) => {}
                        (None, _) => brought = Some(found),
                        (Some(first), _) if self.is_same_binding(first, found) => {}
                        _ => return ImportSource::Unknown,
                    }
                }
                Star::Outside(specifier) => {
                    if brought.is_none()
                        && self
                            .files
                            .module_of_specifier(file, specifier)
                            .is_some_and(has_it)
                    {
                        return ImportSource::External {
                            specifier,
                            name: Some(name),
                        };
                    }
                }
            }
        }
        brought.unwrap_or(ImportSource::Unknown)
    }

    fn star_exports(&self, file: FileId) -> &'c Stars {
        self.shared.stars[file.idx()].get_or_init(|| {
            let mut stars = Stars {
                list: self.resolved_star_exports(file),
                ..Stars::default()
            };
            let mut names_through: FxHashMap<FileId, Option<Rc<FxHashSet<Atom>>>> =
                FxHashMap::default();
            names_through.insert(file, None);
            for (index, &star) in stars.list.iter().enumerate() {
                match star {
                    Star::Module(imported) => {
                        match self.names_exported_via_stars(imported, &mut names_through) {
                            Some(names) => names.iter().for_each(|&name| {
                                stars.by_name.entry(name).or_default().push(index as u32)
                            }),
                            None => stars.wildcard_stars.push(index as u32),
                        }
                    }
                    Star::Object(_) | Star::Outside(_) => stars.wildcard_stars.push(index as u32),
                }
            }
            stars
        })
    }

    fn resolved_star_exports(&self, file: FileId) -> Vec<Star> {
        let resolved = |specifier: Atom| match self.imported_file(file, specifier) {
            Some(imported) if self.has_exports_object(imported) => Star::Object(imported),
            Some(imported) => Star::Module(imported),
            None => Star::Outside(specifier),
        };
        self.star_export_specifiers(file)
            .into_iter()
            .map(resolved)
            .collect()
    }

    fn names_exported_via_stars(
        &self,
        file: FileId,
        known: &mut FxHashMap<FileId, Option<Rc<FxHashSet<Atom>>>>,
    ) -> Option<Rc<FxHashSet<Atom>>> {
        if let Some(found) = known.get(&file) {
            return found.clone();
        }
        known.insert(file, None);
        let mut names: FxHashSet<Atom> = self
            .files
            .exports(self.files.file_symbol(file))
            .into_iter()
            .map(|export| export.0)
            .collect();
        let mut is_whole = true;
        for star in self.resolved_star_exports(file) {
            match star {
                Star::Module(imported) => match self.names_exported_via_stars(imported, known) {
                    Some(more) => names.extend(more.iter().copied()),
                    None => is_whole = false,
                },
                Star::Object(_) | Star::Outside(_) => is_whole = false,
            }
        }
        let found = is_whole.then(|| Rc::new(names));
        known.insert(file, found.clone());
        found
    }

    fn is_same_binding(&self, a: ImportSource, b: ImportSource) -> bool {
        let followed = |source| match source {
            ImportSource::Declaration(exported) if self.is_import(exported) => {
                self.import_source(exported)
            }
            source => source,
        };
        match (followed(a), followed(b)) {
            (ImportSource::Declaration(a), ImportSource::Declaration(b)) => a == b,
            (ImportSource::Namespace(a), ImportSource::Namespace(b))
            | (ImportSource::DeferredNamespace(a), ImportSource::DeferredNamespace(b)) => a == b,
            (ImportSource::Entity(a), ImportSource::Entity(b)) => a == b,
            (
                ImportSource::ExportedObject {
                    file: a, name: x, ..
                },
                ImportSource::ExportedObject {
                    file: b, name: y, ..
                },
            ) => a == b && x == y,
            (
                ImportSource::External {
                    specifier: a,
                    name: x,
                },
                ImportSource::External {
                    specifier: b,
                    name: y,
                },
            ) => a == b && x == y,
            _ => false,
        }
    }

    fn star_export_specifiers(&self, file: FileId) -> Vec<Atom> {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let stars = bound
            .export_stars
            .iter()
            .filter(|star| star.0 == bound.file_symbol);
        stars
            .filter_map(|star| match hir[star.1].kind {
                StmtKind::ExportStar {
                    spec,
                    type_only: false,
                    ..
                } => Some(spec),
                _ => None,
            })
            .filter(|&specifier| !self.is_dropped_import(file, specifier))
            .collect()
    }

    pub(crate) fn file_exports(&self, file: FileId) -> Vec<(Atom, ImportSource)> {
        let mut names = Vec::new();
        self.add_exported_names(
            file,
            false,
            &mut names,
            &mut FxHashSet::default(),
            &mut vec![file],
        );
        names
            .into_iter()
            .map(|name| (name, self.export_source(file, name)))
            .filter(|export| !matches!(export.1, ImportSource::Unknown))
            .collect()
    }

    fn is_js_only_export(&self, exported: Sym) -> bool {
        self.hir(exported.file).is_js
            && self.files.flags(exported).contains(SymFlags::ALIAS)
            && !self.files.means(exported, SymFlags::VALUE)
            && self.files.resolve_alias(exported).is_some_and(|target| {
                let declared = self.files.decls(target);
                declared
                    .iter()
                    .any(|&(of, _)| self.hir(of).kind == FileKind::Declaration)
            })
    }

    fn add_exported_names(
        &self,
        file: FileId,
        is_exported_whole: bool,
        names: &mut Vec<Atom>,
        added: &mut FxHashSet<Atom>,
        seen: &mut Vec<FileId>,
    ) {
        let mut add = |name: Atom, exported: Sym, is_exported_whole: bool| {
            let flags = self.files.symbol_flags(exported);
            if (flags.intersects(SymFlags::VALUE) || self.is_js_only_export(exported))
                && name != known::export_equals
                && !(is_exported_whole && name == known::default)
                && added.insert(name)
            {
                names.push(name);
            }
        };
        for (name, exported) in self.files.exports(self.files.file_symbol(file)) {
            if name == known::export_equals && !is_exported_whole {
                add(known::default, exported, false);
                add(self.c.atoms().intern(b"module.exports"), exported, false);
            }
            add(name, exported, is_exported_whole);
        }
        let mut modules = Vec::new();
        for specifier in self.star_export_specifiers(file) {
            let module = match self.imported_file(file, specifier) {
                Some(imported) if !self.has_exports_object(imported) => {
                    modules.push(imported);
                    continue;
                }
                Some(imported) => Some(self.files.file_symbol(imported)),
                None => self.files.module_of_specifier(file, specifier),
            };
            for &(name, exported) in
                module.map_or(&[][..], |module| self.files.exports_of_module(module))
            {
                add(name, exported, true);
            }
        }
        for imported in modules {
            if !seen.contains(&imported) {
                seen.push(imported);
                self.add_exported_names(imported, true, names, added, seen);
            }
        }
    }

    pub(crate) fn unproven_builtin_imports(
        &mut self,
        file: FileId,
        specifier: Atom,
    ) -> (&'static [u8], Vec<(Atom, bool)>) {
        let Some((module, known)) = known_builtin_exports(self.c.atoms().bytes(specifier)) else {
            return (b"", Vec::new());
        };
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut unproven: Vec<(Atom, Atom)> = Vec::new();
        let mut retained: Vec<(Atom, bool)> = Vec::new();
        for export in hir
            .exports
            .iter()
            .filter(|export| export.spec == specifier && !export.type_only)
        {
            let is_known = |name: Atom| {
                known
                    .binary_search_by(|probe| (*probe).cmp(self.c.atoms().bytes(name)))
                    .is_ok()
            };
            retained.extend(
                export
                    .items
                    .iter()
                    .map(|item| &hir[item])
                    .filter(|item| !item.type_only && !is_known(item.local))
                    .map(|item| (item.local, true)),
            );
        }
        let is_reexported = |local: Atom| {
            hir.exports.iter().any(|export| {
                export.spec.is_none() && export.items.iter().any(|item| hir[item].local == local)
            })
        };
        for stmt in hir.ids(hir.body) {
            let StmtKind::Import(import) = hir[stmt].kind else {
                continue;
            };
            if hir[import].spec != specifier || hir[import].type_only {
                continue;
            }
            let named = hir[import]
                .named
                .iter()
                .map(|spec| &hir[spec])
                .filter(|spec| !spec.type_only);
            let is_known = |name: Atom| {
                known
                    .binary_search_by(|probe| (*probe).cmp(self.c.atoms().bytes(name)))
                    .is_ok()
            };
            unproven.extend(
                named
                    .filter(|spec| !is_known(spec.imported))
                    .map(|spec| (spec.imported, spec.local)),
            );
        }
        let drops_unused_imports = !hir.is_js || self.shared.constants.source_path_to_url.is_none();
        if unproven.is_empty() || !drops_unused_imports {
            retained.extend(
                unproven
                    .into_iter()
                    .map(|(imported, local)| (imported, is_reexported(local))),
            );
            return (module, retained);
        }
        for (imported, local) in unproven {
            let is_exported = is_reexported(local);
            let mut is_used = is_exported;
            for (index, node) in hir.exprs.iter().enumerate() {
                let e = hir::ExprId(index as u32);
                if is_used
                    || !matches!(node.kind, hir::ExprKind::Ident(name) if name == local)
                    || bound.expr_parent[index] == Parent::None
                    || bound.is_in_type_query(e)
                {
                    continue;
                }
                let Some(sym) = self.ident_binding(file, e, local) else {
                    continue;
                };
                is_used = self.is_import(sym);
            }
            if is_used {
                retained.push((imported, is_exported));
            }
        }
        (module, retained)
    }

    pub(crate) fn is_namespace_used_as_value(
        &mut self,
        importer: FileId,
        imported: FileId,
    ) -> bool {
        let (hir, bound) = (self.hir(importer), self.c.bound(importer));
        let references_it = |stmt: hir::StmtId| match hir[stmt].kind {
            StmtKind::Import(import) => {
                hir[import].namespace.is_some()
                    && !hir[import].type_only
                    && self.imported_file(importer, hir[import].spec) == Some(imported)
            }
            _ => false,
        };
        if !self.is_commonjs(imported) || !hir.ids(hir.body).any(references_it) {
            return false;
        }
        for (index, node) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = node.kind else {
                continue;
            };
            let e = hir::ExprId(index as u32);
            let is_read_by_name = match bound.expr_parent[index] {
                Parent::Expr(read) if matches!(hir[read].kind, hir::ExprKind::Dot { obj, chain: hir::Chain::No, .. } if obj == e) =>
                {
                    let mut top = read;
                    while let Parent::Expr(around) = bound.expr_parent[top.idx()]
                        && matches!(
                            hir[around].kind,
                            hir::ExprKind::As { .. }
                                | hir::ExprKind::Satisfies { .. }
                                | hir::ExprKind::NonNull(_)
                        )
                    {
                        top = around;
                    }
                    match bound.expr_parent[top.idx()] {
                        Parent::Expr(around) => match hir[around].kind {
                            hir::ExprKind::Call(call)
                            | hir::ExprKind::New(call)
                            | hir::ExprKind::TaggedTemplate(call) => hir[call].callee != top,
                            hir::ExprKind::Unary { op, .. } => !matches!(
                                op,
                                hir::UnOp::Delete
                                    | hir::UnOp::PreInc
                                    | hir::UnOp::PreDec
                                    | hir::UnOp::PostInc
                                    | hir::UnOp::PostDec
                            ),
                            hir::ExprKind::Assign { target, .. } => target != top,
                            hir::ExprKind::Instantiation { .. } | hir::ExprKind::AsConst(_) => {
                                false
                            }
                            _ => true,
                        },
                        _ => true,
                    }
                }
                Parent::None => true,
                _ => false,
            };
            if is_read_by_name {
                continue;
            }
            let Some(sym) = self.ident_binding(importer, e, name) else {
                continue;
            };
            if self.is_import(sym)
                && matches!(self.import_source(sym), ImportSource::ExportedObject { file, name: None, .. } if file == imported)
            {
                return true;
            }
        }
        false
    }

    pub(crate) fn namespace_import_of_exported_object(
        &mut self,
        fx: &Fx,
        e: hir::ExprId,
    ) -> Option<(FileId, FileId)> {
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else {
            return None;
        };
        let sym = self.ident_binding(fx.file, e, name)?;
        match self.is_import(sym).then(|| self.import_source(sym))? {
            ImportSource::ExportedObject {
                importer,
                file,
                name: None,
            } => Some((importer, file)),
            _ => None,
        }
    }

    pub(crate) fn entity_alias_declaration(
        &self,
        alias: Sym,
    ) -> Option<(FileId, hir::ImportEqualsId)> {
        self.files
            .decls_of(alias)
            .iter()
            .copied()
            .find_map(|(file, decl)| match decl {
                Decl::ImportEquals(import)
                    if matches!(
                        self.hir(file)[import].target,
                        hir::ImportEqualsTarget::Entity(_)
                    ) =>
                {
                    Some((file, import))
                }
                _ => None,
            })
    }

    pub(crate) fn entity_alias_kind(&mut self, alias: Sym) -> EntityAlias {
        if let Some(&known) = self.entity_aliases.get(&alias) {
            return known;
        }
        self.entity_aliases.insert(alias, EntityAlias::CopiedValue);
        let kind = self.entity_alias_kind_uncached(alias);
        self.entity_aliases.insert(alias, kind);
        kind
    }

    fn entity_alias_kind_uncached(&mut self, alias: Sym) -> EntityAlias {
        let Some((file, import)) = self.entity_alias_declaration(alias) else {
            return EntityAlias::TypeOnly;
        };
        if !self.files.symbol_flags(alias).intersects(SymFlags::VALUE) {
            return EntityAlias::TypeOnly;
        }
        if self.exporting_reified_namespace(alias).is_some() {
            return EntityAlias::CopiedValue;
        }
        match self.alias_path_binding(file, import) {
            Some(binding)
                if self.is_immutable_binding(binding)
                    && self
                        .c
                        .namespace_runs_before_import_equals(binding, file, import) =>
            {
                EntityAlias::SameBinding(binding)
            }
            _ => EntityAlias::CopiedValue,
        }
    }

    fn is_immutable_binding(&mut self, binding: Sym) -> bool {
        match self.value_declaration(binding) {
            Some((_, Decl::Fn(_))) => !self.is_assigned(binding),
            Some((
                _,
                Decl::Class(_) | Decl::Enum(_) | Decl::EnumMember(_) | Decl::Module(_) | Decl::File,
            )) => true,
            Some((_, Decl::Var(_))) => {
                self.c.is_constant(binding) && self.namespace_with_property(binding).is_none()
            }
            _ => false,
        }
    }

    fn alias_path_binding(&mut self, file: FileId, import: hir::ImportEqualsId) -> Option<Sym> {
        let path = self.resolve_alias_path(file, import);
        match path.source {
            Some(ImportSource::Declaration(found) | ImportSource::Entity(found))
                if path.resolved_count == path.names.len() =>
            {
                let binding = self.value_symbol(found);
                (!self.is_ambient(binding)).then_some(binding)
            }
            _ => None,
        }
    }

    fn resolve_alias_path(
        &mut self,
        file: FileId,
        import: hir::ImportEqualsId,
    ) -> ResolvedAliasPath {
        let names: Vec<Atom> = match self.hir(file)[import].target {
            hir::ImportEqualsTarget::Entity(names) => self.hir(file).texts(names).collect(),
            hir::ImportEqualsTarget::Require(_) => Vec::new(),
        };
        let mut path = ResolvedAliasPath {
            source: None,
            names,
            resolved_count: 1,
            crossed_aliases: Vec::new(),
        };
        let scope = self.c.bound(file).import_equals_scope[import.idx()];
        let Some(root) = path.names.first().and_then(|_| {
            self.files.resolve_entity(
                file,
                scope,
                &path.names[..1],
                SymFlags::VALUE | SymFlags::NAMESPACE | SymFlags::ALIAS,
            )
        }) else {
            return path;
        };
        path.source = Some(ImportSource::Declaration(root));
        while let Some(ImportSource::Declaration(found) | ImportSource::Entity(found)) = path.source
        {
            let holder = self.value_symbol_inner(found, &mut path.crossed_aliases);
            if path.resolved_count == path.names.len()
                || self.is_ambient(holder)
                || self.has_exports_object(holder.file)
            {
                break;
            }
            let (name, flags) = (path.names[path.resolved_count], self.files.flags(holder));
            let next = if matches!(self.value_declaration(holder), Some((_, Decl::File))) {
                match self.export_source(holder.file, name) {
                    ImportSource::Unknown => {
                        match self.single_object_behind_stars_member(holder.file, name) {
                            ImportSource::Unknown => None,
                            source => Some(source),
                        }
                    }
                    ImportSource::Namespace(module) => {
                        Some(ImportSource::Declaration(self.files.file_symbol(module)))
                    }
                    source => Some(source),
                }
            } else if flags.intersects(SymFlags::ENUM)
                || flags.intersects(SymFlags::VALUE_MODULE) && !self.c.is_reified_namespace(holder)
            {
                self.files
                    .export(holder, name)
                    .map(ImportSource::Declaration)
            } else {
                None
            };
            let Some(next) = next else { break };
            path.source = Some(next);
            path.resolved_count += 1;
        }
        path
    }

    fn read_alias_path(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        import: hir::ImportEqualsId,
        pos: u32,
    ) -> V {
        let path = self.resolve_alias_path(file, import);
        for &crossed in &path.crossed_aliases {
            self.check_entity_alias_initialized(fx, crossed, hir::ExprId::NONE);
        }
        let mut value = match path.source {
            Some(ImportSource::Declaration(found) | ImportSource::Entity(found)) => self
                .read_binding(
                    fx,
                    Some(found),
                    path.names[path.resolved_count - 1],
                    None,
                    pos,
                    false,
                ),
            Some(source) => self.read_import(fx, source, pos),
            None => self.read_binding(fx, None, path.names[0], None, pos, false),
        };
        for &name in &path.names[path.resolved_count..] {
            let name = self.str(name);
            value = self.emit_throwing(fx, Op::PropGet { obj: value, name });
        }
        value
    }

    fn entity_alias_global(&mut self, alias: Sym) -> GlobalId {
        if let Some(Place::Global(known)) = self.places.get(&alias) {
            return *known;
        }
        let name = self.str(self.files.symbol(alias).name);
        let variable = self.add_global(
            name,
            alias.file,
            Ty::NONE,
            GlobalKey::Symbol(alias.file, alias.id),
        );
        let was = self.places.insert(alias, Place::Global(variable));
        if let Some(undo) = &mut self.undo {
            undo.places.push((alias, was));
        }
        variable
    }

    pub(crate) fn check_entity_alias_initialized(
        &mut self,
        fx: &mut Fx,
        alias: Sym,
        e: hir::ExprId,
    ) {
        let Some((of, import)) = self.entity_alias_declaration(alias) else {
            return;
        };
        if matches!(self.entity_alias_kind(alias), EntityAlias::SameBinding(_))
            && self.c.may_run_before_import_equals(of, import, fx.file, e)
        {
            let variable = self.entity_alias_global(alias);
            self.emit_throwing(fx, Op::GlobalGet(variable));
        }
    }

    pub(crate) fn read_entity_alias(&mut self, fx: &mut Fx, alias: Sym, e: hir::ExprId) -> V {
        if let Some(namespace) = self.exporting_reified_namespace(alias) {
            return self.read_namespace_property(fx, namespace, alias);
        }
        let variable = self.entity_alias_global(alias);
        let may_run_early = match self.entity_alias_declaration(alias) {
            Some((of, import)) => self.c.may_run_before_import_equals(of, import, fx.file, e),
            None => true,
        };
        if may_run_early {
            return self.emit_throwing(fx, Op::GlobalGet(variable));
        }
        let found = self.emit(fx, Op::GlobalGet(variable));
        fx.b.func.values[found.idx()].set_is_known_initialized(true);
        found
    }

    fn starts_with_named_import(&mut self, file: FileId, import: hir::ImportEqualsId) -> bool {
        let hir::ImportEqualsTarget::Entity(names) = self.hir(file)[import].target else {
            return false;
        };
        let names: Vec<Atom> = self.hir(file).texts(names).collect();
        let scope = self.c.bound(file).import_equals_scope[import.idx()];
        let root = names.first().and_then(|_| {
            self.files.resolve_entity(
                file,
                scope,
                &names[..1],
                SymFlags::VALUE | SymFlags::NAMESPACE | SymFlags::ALIAS,
            )
        });
        root.is_some_and(|root| {
            self.files
                .decls_of(root)
                .iter()
                .copied()
                .any(|(_, decl)| matches!(decl, Decl::ImportSpec(_) | Decl::ImportDefault(_)))
        })
    }

    pub(crate) fn emit_entity_alias(&mut self, fx: &mut Fx, import: hir::ImportEqualsId, pos: u32) {
        let file = fx.file;
        let Some((alias, is_referenced)) = self.c.import_equals_symbol(file, import) else {
            return;
        };
        let kind = self.entity_alias_kind(alias);
        if matches!(kind, EntityAlias::TypeOnly)
            || !is_referenced && !self.starts_with_named_import(file, import)
        {
            return;
        }
        if let EntityAlias::SameBinding(binding) = kind {
            let path = self.resolve_alias_path(file, import);
            for &crossed in &path.crossed_aliases {
                self.check_entity_alias_initialized(fx, crossed, hir::ExprId::NONE);
            }
            if matches!(
                self.value_declaration(binding),
                Some((_, Decl::Var(_) | Decl::Class(_)))
            ) && self.may_be_in_tdz(fx, binding, hir::ExprId::NONE)
            {
                self.read_sym(fx, binding, pos);
            }
            let (variable, marker) = (
                self.entity_alias_global(alias),
                self.emit(fx, Op::Undefined),
            );
            self.emit(fx, Op::GlobalSet(variable, marker));
            return;
        }
        let value = self.read_alias_path(fx, file, import, pos);
        let Some(namespace) = self.exporting_reified_namespace(alias) else {
            let variable = self.entity_alias_global(alias);
            self.emit(fx, Op::GlobalSet(variable, value));
            return;
        };
        let member = self.files.symbol(alias).name;
        if let Some(holder) = self
            .namespace_layout(namespace)
            .and_then(|layout| self.layout_types.get(&layout).copied())
        {
            match self
                .alias_path_binding(file, import)
                .and_then(|binding| self.function_declaration_for(binding))
            {
                Some((of, func)) => self.c.record_declared_callee(holder, member, of, func),
                None => self.c.record_unknown_callee(holder, member, file, pos),
            }
        }
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(member);
        self.emit_throwing(fx, Op::PropSet { obj, name, value });
    }

    pub(crate) fn read_import(&mut self, fx: &mut Fx, source: ImportSource, pos: u32) -> V {
        let (namespace, name) = match source {
            ImportSource::Text { file, specifier } => {
                let text = self.imported_text(file, specifier).unwrap_or_default();
                return self.emit_asset_value(fx, file, specifier, text);
            }
            ImportSource::External {
                specifier,
                name: None,
            } if self.c.atoms().bytes(specifier) == b"bun" => {
                let bun = self.out.strs.intern(b"Bun");
                return self.emit_throwing(
                    fx,
                    Op::FreeGet {
                        name: bun,
                        is_typeof: false,
                    },
                );
            }
            ImportSource::External { specifier, name } => {
                (self.external_module(fx, specifier), name)
            }
            ImportSource::ExportedObject {
                importer,
                file,
                name: Some(name),
            } => {
                let name = self.c.atoms().bytes(name);
                return self.exported_object_member(fx, importer, file, name);
            }
            ImportSource::ExportedObject {
                importer,
                file,
                name: None,
            } => (self.exported_object_namespace(fx, importer, file), None),
            ImportSource::DeferredNamespace(file) => {
                return self.deferred_namespace_object(fx, file);
            }
            ImportSource::Required(file) => return self.cached_require_result(fx, file),
            _ if self.report_unknown_runtime_helpers(fx.file) => {
                return self.emit(fx, Op::Undefined);
            }
            _ => {
                return self.unsupported(
                    fx,
                    pos,
                    "an import of a name that the module does not export",
                );
            }
        };
        match name {
            Some(name) => {
                let name = self.str(name);
                self.emit_throwing(
                    fx,
                    Op::PropGet {
                        obj: namespace,
                        name,
                    },
                )
            }
            None => namespace,
        }
    }
}
