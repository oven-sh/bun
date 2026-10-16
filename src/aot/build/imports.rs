//! Imports: which code an import stands for.
//!
//! Every import is resolved twice. The checker resolves it for its types, as `bun check` does: `react` is `@types/react/index.d.ts`.
//! The bundler resolves it for the code that runs: `react/index.js`. The symbol the checker has for an imported name says what type
//! its value is of. The value is what the bundler's file exports under that name. Nothing here follows the checker from one module
//! to the next: an import, a re-export and `export *` all go where the bundler has them go.

use super::fit::Ty;
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
pub(crate) enum HostLoads {
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
    for_any_name: Vec<u32>,
}

impl Stars {
    fn that_may_bring(&self, name: Atom) -> Vec<Star> {
        let mut indices: Vec<u32> = self.by_name.get(&name).into_iter().flatten().chain(&self.for_any_name).copied().collect();
        indices.sort_unstable();
        indices.into_iter().map(|index| self.list[index as usize]).collect()
    }
}

/// Where an import gets its value from.
#[derive(Copy, Clone)]
pub(crate) enum ImportSource {
    /// What an ES module of the program exports under the name the import asks for, which is no import itself.
    Declaration(Sym),
    /// All that an ES module of the program exports: `import * as ns`.
    Namespace(FileId),
    /// `import defer * as ns`, of a module in `Shared::modules_deferred`.
    DeferredNamespace(FileId),
    /// `import a = b.c`: what the checker has `b.c` stand for.
    Entity(Sym),
    /// A property of what a CommonJS or JSON module exports, as an ES module sees it. No name: all of it.
    ExportedObject { importer: FileId, file: FileId, name: Option<Atom> },
    /// A module that is not compiled with the program.
    External { specifier: Atom, name: Option<Atom> },
    /// The default export of a file that is imported as a string, which `file` imports as `specifier`.
    Text { file: FileId, specifier: Atom },
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
    aliases_crossed: Vec<Sym>,
}

pub(crate) fn is_builtin_specifier(specifier: &[u8]) -> bool {
    specifier == b"bun" || specifier.starts_with(b"bun:") || specifier.starts_with(b"node:") || known_builtin_exports(specifier).is_some()
}

fn known_builtin_exports(specifier: &[u8]) -> Option<(&'static [u8], &'static [&'static [u8]])> {
    static TABLE: std::sync::OnceLock<Vec<(&'static [u8], Vec<&'static [u8]>)>> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let lines = include_str!("../builtin-export-names.txt").lines();
        lines.filter_map(|line| line.split_once(' ')).map(|(module, names)| (module.as_bytes(), names.split(' ').map(str::as_bytes).collect())).collect()
    });
    let find = |name: &[u8]| table.binary_search_by_key(&name, |module| module.0).ok();
    let found = find(specifier).or_else(|| find(&[&b"node:"[..], specifier].concat()))?;
    Some((table[found].0, table[found].1.as_slice()))
}

pub(crate) fn written_in_the_place_of(files: &Files<'_>, code: FileId) -> FileId {
    let written = files.module(code).file_name().strip_suffix(b".js").and_then(|written| files.by_path.get(written));
    written.filter(|&written| files.lowers_decorators(written)).unwrap_or(code)
}

/// What the bundler has decided about the imports of the program, in terms of the files of the program.
pub(crate) struct Bundle<'p> {
    /// By importing file and specifier: the path the import is resolved to, and the file at it if that is one of the program.
    resolved: FxHashMap<(FileId, &'p [u8]), (&'p [u8], Option<FileId>)>,
    /// `Constants::dropped_imports`
    pub(super) dropped: FxHashSet<(FileId, &'p [u8])>,
    /// See `FileBuild::only_declares`.
    declaring: FxHashSet<FileId>,
    has_requires_resolved_otherwise: bool,
}

impl<'p> Bundle<'p> {
    /// `None`: there is no bundler.
    pub(crate) fn new(files: &Files<'_>, roots: &[FileId], constants: &'p crate::Constants) -> Option<Bundle<'p>> {
        let mut resolved: FxHashMap<(FileId, &'p [u8]), (&'p [u8], Option<FileId>)> = FxHashMap::default();
        let imports = constants.resolved.as_ref()?;
        let files_of_paths: Vec<Option<FileId>> = imports.paths().iter().map(|path| files.by_path.get(path)).collect();
        let found_at: Vec<(&'p [u8], Option<FileId>)> = (imports.paths().iter().zip(&files_of_paths))
            .map(|(to, &printed)| {
                let code = printed.map(|printed| written_in_the_place_of(files, printed));
                (if code == printed { to.as_slice() } else { &to[..to.len() - b".js".len()] }, code)
            })
            .collect();
        for (from, specifier, to) in imports.by_number() {
            let Some(from) = files_of_paths[from as usize] else { continue };
            let found = found_at[to as usize];
            // Two paths can be one file of the program. Then it is the lesser one, in whichever order they come here.
            let known = resolved.entry((from, specifier)).or_insert(found);
            if found.0 < known.0 {
                *known = found;
            }
        }
        let dropped = (constants.dropped_imports.iter())
            .filter_map(|(from, specifier)| Some((files.by_path.get(from)?, specifier.as_slice())))
            .collect();
        let has_requires_resolved_otherwise = resolved.keys().any(|key| key.1.starts_with(crate::REQUIRED_OTHERWISE));
        let mut bundle = Bundle { resolved, dropped, declaring: FxHashSet::default(), has_requires_resolved_otherwise };
        bundle.declaring = bundle.files_that_only_declare(files, roots);
        Some(bundle)
    }

    pub(crate) fn requires_resolved_otherwise(&self) -> impl Iterator<Item = (FileId, &'p [u8], FileId)> + '_ {
        let marked = self.resolved.iter().filter(|_| self.has_requires_resolved_otherwise);
        marked.filter_map(|(&(from, specifier), &(_, to))| Some((from, specifier.strip_prefix(crate::REQUIRED_OTHERWISE)?, to?)))
    }

    pub(crate) fn declaring(&self) -> impl Iterator<Item = FileId> + '_ {
        self.declaring.iter().copied()
    }

    /// What the checker resolves an import to for which other code runs, or code that is not compiled, and what that refers to in turn.
    /// Not a file of the bundle. Not a file that is only imported for its types either: nothing runs in its place.
    fn files_that_only_declare(&self, files: &Files<'_>, roots: &[FileId]) -> FxHashSet<FileId> {
        let mut compiled: FxHashSet<FileId> = roots.iter().copied().collect();
        compiled.extend(self.resolved.values().filter_map(|found| found.1));
        let mut pending: Vec<FileId> = Vec::new();
        for (&(from, specifier), &(_, code)) in &self.resolved {
            let typed_by = files.atoms.lookup(specifier).and_then(|specifier| files.module(from).imported_file(specifier));
            pending.extend(typed_by.filter(|&typed_by| Some(typed_by) != code));
        }
        for &file in &compiled {
            let hir = files.hir(file);
            for stmt in hir.ids(hir.body) {
                let specifier = match hir[stmt].kind {
                    StmtKind::Import(import) if !hir[import].type_only => hir[import].spec,
                    StmtKind::ExportNamed(export) if !hir[export].type_only => hir[export].spec,
                    StmtKind::ExportStar { spec, type_only: false, .. } => spec,
                    _ => continue,
                };
                if specifier.is_none() || names_only_types(hir, stmt) {
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

/// `import { type A, type B } from "m"`, `export { type A } from "m"`: nothing is left of it once the types are taken out.
pub(crate) fn names_only_types(hir: &hir::File<'_>, stmt: hir::StmtId) -> bool {
    match hir[stmt].kind {
        StmtKind::Import(import) => {
            let import = &hir[import];
            import.default.is_none() && import.namespace.is_none() && !import.named.is_empty() && import.named.iter().all(|name| hir[name].type_only)
        }
        StmtKind::ExportNamed(export) => !hir[export].items.is_empty() && hir[export].items.iter().all(|name| hir[name].type_only),
        _ => false,
    }
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn second_form_of(&self, file: FileId) -> Option<FileId> {
        self.shared.bundle.as_ref()?.resolved.get(&(file, crate::SPECIFIER_OF_SECOND_FORM))?.1.filter(|_| self.is_commonjs(file))
    }

    pub(crate) fn is_second_form(&self, file: FileId) -> bool {
        self.files.module(file).file_name().ends_with(crate::SECOND_FORM_SUFFIX)
    }

    pub(crate) fn is_resolved_by_bundler(&self, file: FileId, specifier: Atom) -> bool {
        self.shared.bundle.as_ref().is_some_and(|bundle| bundle.resolved.contains_key(&(file, self.c.atoms().bytes(specifier))))
    }

    /// Whether the file says what there is and the program has no code for it: a declaration file, or a TypeScript file that stands in
    /// for one, as where a package has `"types": "src/index.ts"` and `"main": "dist/index.js"`. What it declares is made by code that
    /// nobody has held to it.
    pub(crate) fn only_declares(&self, file: FileId) -> bool {
        self.hir(file).kind == FileKind::Declaration || self.shared.bundle.as_ref().is_some_and(|bundle| bundle.declaring.contains(&file))
    }

    /// The file whose code an import, an `import()` or a `require()` in `file` runs. `None`: it is not compiled with the program.
    pub(crate) fn imported_file(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        if specifier.is_none() {
            return None;
        }
        if self.is_builtin_file(file) {
            let id = self.builtin_id_required_by(file, specifier)?;
            let modules = self.shared.builtin_modules();
            return modules.binary_search_by_key(&id, |module| module.0).ok().map(|found| modules[found].1);
        }
        let text = self.c.atoms().bytes(specifier);
        if text == b"bun:wrap" {
            return self.shared.runtime_helpers();
        }
        let imported = match &self.shared.bundle {
            Some(bundle) => bundle.resolved.get(&(file, text))?.1?,
            None => self.file_resolved_by_checker(file, specifier)?,
        };
        (!self.only_declares(imported)).then_some(imported)
    }

    pub(crate) fn required_file(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        if let Some(bundle) = self.shared.bundle.as_ref().filter(|bundle| bundle.has_requires_resolved_otherwise && specifier.is_some()) {
            let marked = [crate::REQUIRED_OTHERWISE, self.c.atoms().bytes(specifier)].concat();
            if let Some(found) = bundle.resolved.get(&(file, marked.as_slice())) {
                return found.1.filter(|&required| !self.only_declares(required));
            }
        }
        self.imported_file(file, specifier)
    }

    fn report_unknown_runtime_helpers(&mut self, file: FileId) -> bool {
        let Some(helpers) = self.shared.runtime_helpers() else { return false };
        let hir = self.hir(file);
        let from_runtime = hir.imports.iter().filter(|import| !import.type_only && self.c.atoms().bytes(import.spec) == b"bun:wrap");
        let named: Vec<(u32, Atom)> = from_runtime.flat_map(|import| import.named.iter().map(|spec| &hir[spec])).filter(|spec| !spec.type_only).map(|spec| (spec.imported_pos, spec.imported)).collect();
        let mut is_any_unknown = false;
        for (pos, name) in named {
            if self.binding_exported_as(helpers, name).is_some() {
                continue;
            }
            is_any_unknown = true;
            if !self.problems.iter().any(|problem| problem.file == file && problem.pos == pos) {
                let what = format!("the helper `{}`, which \"bun:wrap\" does not export", bstr::BStr::new(self.c.atoms().bytes(name)));
                self.problems.push(super::Problem { file, pos, what: std::borrow::Cow::Owned(what) });
            }
        }
        is_any_unknown
    }

    /// Without a bundler.
    fn file_resolved_by_checker(&self, file: FileId, specifier: Atom) -> Option<FileId> {
        let module = self.files.module(file);
        if let Some(imported) = module.imported_file(specifier) {
            return Some(imported);
        }
        // The checker does not look at `require()` in TypeScript: a relative path to a file of the program, as it is written.
        let text = self.c.atoms().bytes(specifier);
        if !text.starts_with(b"./") && !text.starts_with(b"../") {
            return None;
        }
        let directory = module.file_name().rsplitn(2, |&byte| byte == b'/').nth(1)?;
        self.files.by_path.get(&bun_sema::resolve::join(directory, text))
    }

    pub(crate) fn as_the_host_finds_it(&self, file: FileId, specifier: Atom) -> Atom {
        let specifier = self.as_the_host_names_it(specifier);
        let text = self.c.atoms().bytes(specifier);
        match self.own_path(file, b"dir") {
            Some(directory) if text.starts_with(b"./") || text.starts_with(b"../") => self.c.atoms().intern(&[&directory[..], b"/", text].concat()),
            _ => specifier,
        }
    }

    pub(crate) fn as_the_host_names_it(&self, specifier: Atom) -> Atom {
        match self.c.atoms().bytes(specifier) {
            b"vitest" | b"@jest/globals" if self.shared.constants.has_test_globals => self.c.atoms().intern(b"bun:test"),
            _ => specifier,
        }
    }

    /// The text of the file that `file` imports as `specifier`, if the bundler loads it as a string.
    pub(crate) fn text_imported_as(&self, file: FileId, specifier: Atom) -> Option<&'c [u8]> {
        if specifier.is_none() {
            return None;
        }
        let path = self.shared.bundle.as_ref()?.resolved.get(&(file, self.c.atoms().bytes(specifier)))?.0;
        // A file that is imported for its path is a string as well.
        self.shared.constants.assets.get(path).or_else(|| self.shared.constants.texts.get(path)).map(Vec::as_slice)
    }

    pub(crate) fn type_told_to_the_host(&self, file: FileId, specifier: Atom) -> Option<Atom> {
        let hir = self.hir(file);
        if specifier.is_none() || hir.import_attributes.is_empty() || self.shared.constants.own_paths.is_none() || self.shared.bundle.is_none() {
            return None;
        }
        if self.text_imported_as(file, specifier).is_some() || self.imported_file(file, specifier).is_some() {
            return None;
        }
        hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) if hir[import].spec == specifier => self.type_attribute(file, stmt),
            _ => None,
        })
    }

    pub(crate) fn is_reached_otherwise_than_with_type(&self, file: FileId, specifier: Atom, said: Option<Atom>) -> bool {
        self.types_said_where_the_program_reaches(file, specifier).iter().any(|&(_, says)| says != said)
    }

    pub(crate) fn is_imported_by_a_statement_with_type(&self, file: FileId, specifier: Atom, said: Atom) -> bool {
        self.types_said_where_the_program_reaches(file, specifier).contains(&(true, Some(said)))
    }

    pub(crate) fn type_said_by_options(&self, file: FileId, options: Option<hir::ExprId>) -> Option<Atom> {
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

    fn types_said_where_the_program_reaches(&self, file: FileId, specifier: Atom) -> Vec<(bool, Option<Atom>)> {
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
        let asked_for = without_dots(self.c.atoms().bytes(self.as_the_host_finds_it(file, specifier)));
        let mut found = Vec::new();
        for &module in &self.shared.modules {
            let hir = self.hir(module);
            for used in hir.specifier_uses.iter() {
                if used.kind == hir::SpecifierKind::ImportType || without_dots(self.c.atoms().bytes(self.as_the_host_finds_it(module, used.spec))) != asked_for {
                    continue;
                }
                found.push(match used.kind {
                    hir::SpecifierKind::Import | hir::SpecifierKind::SideEffect => {
                        let statement = hir.ids(hir.body).find(|&stmt| hir[stmt].start <= used.pos && used.pos < hir[stmt].loc.end);
                        (true, statement.and_then(|stmt| self.type_attribute(module, stmt)))
                    }
                    hir::SpecifierKind::ImportCall => {
                        let options = hir.exprs.iter().find_map(|e| match e.kind {
                            hir::ExprKind::ImportCall { args } if hir[hir.id_at(args, 0)].pos == used.pos => hir.ids(args).nth(1),
                            _ => None,
                        });
                        (false, self.type_said_by_options(module, options))
                    }
                    _ => (false, None),
                });
            }
        }
        found
    }

    pub(crate) fn asset_the_host_loads(&self, file: FileId, specifier: Atom) -> Option<HostLoads> {
        if let Some(said) = self.type_told_to_the_host(file, specifier) {
            return Some(HostLoads::OfType(said));
        }
        let path = self.shared.bundle.as_ref()?.resolved.get(&(file, self.c.atoms().bytes(specifier)))?.0;
        let stands_for_it = self.shared.constants.assets.get(path)?;
        if stands_for_it.len() == 25 && stands_for_it[16] == b'H' {
            return Some(HostLoads::Manifest);
        }
        let hir = self.hir(file);
        let said = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) if hir[import].spec == specifier => self.type_attribute(file, stmt),
            _ => None,
        });
        match said.map(|said| self.c.atoms().bytes(said)) {
            Some(b"napi" | b"node") => Some(HostLoads::Addon),
            Some(b"sqlite") => Some(HostLoads::Database),
            Some(_) => None,
            None => path.ends_with(b".node").then_some(HostLoads::Addon),
        }
    }

    /// Whether the bundle has what `file` imports as `specifier` and the program has not: it is neither code nor a constant.
    pub(crate) fn is_in_the_bundle_only(&self, file: FileId, specifier: Atom) -> bool {
        specifier.is_some()
            && self.text_imported_as(file, specifier).is_none()
            && (self.shared.bundle.as_ref()).is_some_and(|bundle| bundle.resolved.get(&(file, self.c.atoms().bytes(specifier))).is_some_and(|found| found.1.is_none()))
    }

    /// Whether the bundler has left the import out: nothing is evaluated for it.
    pub(crate) fn is_dropped_import(&self, file: FileId, specifier: Atom) -> bool {
        specifier.is_some() && self.shared.bundle.as_ref().is_some_and(|bundle| bundle.dropped.contains(&(file, self.c.atoms().bytes(specifier))))
    }

    /// The module that `file` imports implicitly for its JSX. The checker has it from the options of the project. Which of the two
    /// runtimes of the package runs, the one for development or the other, is up to the bundler.
    pub(crate) fn jsx_runtime(&self, file: FileId) -> Option<Atom> {
        let runtime = self.files.jsx_runtime(file)?;
        let Some(bundle) = &self.shared.bundle else { return Some(runtime) };
        let text = self.c.atoms().bytes(runtime);
        if bundle.resolved.contains_key(&(file, text)) {
            return Some(runtime);
        }
        let other = match (text.strip_suffix(b"/jsx-runtime"), text.strip_suffix(b"/jsx-dev-runtime")) {
            (Some(package), _) => [package, b"/jsx-dev-runtime"].concat(),
            (None, Some(package)) => [package, b"/jsx-runtime"].concat(),
            (None, None) => return Some(runtime),
        };
        let is_imported = bundle.resolved.contains_key(&(file, other.as_slice()));
        Some(if is_imported { self.c.atoms().intern(&other) } else { runtime })
    }

    /// Whether the symbol is an import or a re-export, which has its value from another module.
    pub(crate) fn is_import(&self, sym: Sym) -> bool {
        self.files.flags(sym).contains(SymFlags::ALIAS) && self.is_declared_by_import(sym)
    }

    /// The symbol that stands for the value `sym` refers to: the end of a chain of imports, and the export of a declaration.
    pub(crate) fn value_symbol(&mut self, sym: Sym) -> Sym {
        if !self.files.flags(sym).contains(SymFlags::ALIAS) {
            return self.value_symbol_after(sym, &mut Vec::new());
        }
        if let Some(&known) = self.value_symbols.get(&sym) {
            return known;
        }
        let found = self.value_symbol_after(sym, &mut Vec::new());
        self.value_symbols.insert(sym, found);
        found
    }

    /// `seen`: see `value_symbol_of_export_after`.
    pub(crate) fn value_symbol_after(&mut self, sym: Sym, seen: &mut Vec<Sym>) -> Sym {
        let mut sym = sym;
        if self.is_import(sym) {
            match self.import_source(sym) {
                ImportSource::Declaration(exported) => return self.value_symbol_of_export_after(exported, seen),
                ImportSource::Namespace(file) => return self.files.file_symbol(file),
                ImportSource::Entity(alias) => match self.entity_alias_kind(alias) {
                    EntityAlias::SameBinding(binding) => {
                        seen.push(alias);
                        return binding;
                    }
                    EntityAlias::CopiedValue => return alias,
                    EntityAlias::TypeOnly => {}
                },
                // What a CommonJS module exports is not known before it has run: the import stays an import.
                _ => return sym,
            }
            if let Some(target) = self.files.resolve_alias(sym) {
                sym = target;
            }
        }
        self.files.export_symbol_of_value_symbol_if_exported(sym)
    }

    /// What holds the value of an export of an ES module of the program.
    pub(crate) fn value_symbol_of_export(&mut self, exported: Sym) -> Sym {
        self.value_symbol_of_export_after(exported, &mut Vec::new())
    }

    /// `seen`: the exports `export default name` that have led here. Where each of them names what it imports from the next, round in
    /// a circle, the one that is come by again holds its value itself.
    fn value_symbol_of_export_after(&mut self, exported: Sym, seen: &mut Vec<Sym>) -> Sym {
        for (file, decl) in self.files.decls(exported) {
            let Decl::ExportExpr(stmt) = decl else { continue };
            let StmtKind::ExportDefault(e) = self.hir(file)[stmt].kind else { continue };
            if seen.contains(&exported) {
                return exported;
            }
            seen.push(exported);
            return self.binding_exported_as_default_after(file, e, seen).unwrap_or(exported);
        }
        if self.is_import(exported) {
            return self.value_symbol_after(exported, seen);
        }
        let mut sym = exported;
        if self.files.flags(sym).contains(SymFlags::ALIAS)
            && let Some(target) = self.files.resolve_alias(sym)
        {
            if self.files.symbol(exported).name == known::export_equals && matches!(self.value_declaration(target), Some((_, Decl::Var(_) | Decl::Param(_)))) {
                return exported;
            }
            sym = target;
        }
        self.files.export_symbol_of_value_symbol_if_exported(sym)
    }

    /// The binding of the program that the ES module `file` exports as `name`. `None`: there is none, or its value is only known when
    /// the program runs.
    pub(crate) fn binding_exported_as(&mut self, file: FileId, name: Atom) -> Option<Sym> {
        match self.source_of_export(file, name) {
            ImportSource::Declaration(exported) => Some(self.value_symbol_of_export(exported)),
            ImportSource::Namespace(file) => Some(self.files.file_symbol(file)),
            _ => None,
        }
    }

    /// Whether the object that stands for the ES module `file` has no property `name`, whatever happens when the program runs: the module exports nothing by the name, or only a type, and all
    /// that it re-exports whole is ES modules of the program.
    pub(crate) fn is_known_not_to_export(&mut self, file: FileId, name: Atom) -> bool {
        if self.files.export(self.files.file_symbol(file), known::export_equals).is_some() {
            return false;
        }
        match self.source_of_export(file, name) {
            ImportSource::Declaration(exported) => {
                let member = self.value_symbol_of_export(exported);
                !self.has_value_at_runtime(member)
            }
            ImportSource::Unknown => self.re_exports_only_program_modules(file, &mut vec![file]),
            _ => false,
        }
    }

    /// Not a type or what is only declared.
    pub(crate) fn has_value_at_runtime(&self, member: Sym) -> bool {
        let flags = self.files.flags(member);
        flags.intersects(SymFlags::VALUE) && !self.is_ambient(member)
    }

    fn re_exports_only_program_modules(&self, file: FileId, seen: &mut Vec<FileId>) -> bool {
        self.modules_exported_whole(file).into_iter().all(|specifier| match self.imported_file(file, specifier) {
            Some(imported) if self.exports_an_object(imported) => false,
            Some(imported) if seen.contains(&imported) => true,
            Some(imported) => {
                seen.push(imported);
                self.re_exports_only_program_modules(imported, seen)
            }
            None => false,
        })
    }

    /// Where an import gets its value from, through the re-exports of the ES modules of the program.
    pub(crate) fn import_source(&self, alias: Sym) -> ImportSource {
        if let Some(&known) = self.import_sources.borrow().get(&alias) {
            return known;
        }
        // A cycle of re-exports, which is an error that the type checker reports, ends here.
        self.import_sources.borrow_mut().insert(alias, ImportSource::Unknown);
        let source = self.import_source_uncached(alias);
        self.import_sources.borrow_mut().insert(alias, source);
        source
    }

    fn import_source_uncached(&self, alias: Sym) -> ImportSource {
        for (file, decl) in self.files.decls(alias) {
            let hir = self.hir(file);
            let is_deferred = matches!(decl, Decl::ImportNamespace(import) if hir[import].is_deferred);
            let (specifier, name) = match decl {
                Decl::ImportDefault(import) => (hir[import].spec, Some(known::default)),
                Decl::ImportNamespace(import) => (hir[import].spec, None),
                Decl::ImportSpec(spec) => (hir[hir[spec].import].spec, Some(hir[spec].imported)),
                // `export { a as b } from "m"`
                Decl::ExportSpec(spec) if hir[hir[spec].export].spec.is_some() => (hir[hir[spec].export].spec, Some(hir[spec].local)),
                // `import { a } from "m"; export { a }`
                Decl::ExportSpec(_) => match self.files.alias_target(alias) {
                    Some(next) if next == alias => return ImportSource::Unknown,
                    Some(next) if self.is_import(next) => return self.import_source(next),
                    Some(next) => return ImportSource::Declaration(next),
                    None => continue,
                },
                // `export * as ns from "m"`
                Decl::ExportStarAs(stmt) => match hir[stmt].kind {
                    StmtKind::ExportStar { spec, .. } => (spec, None),
                    _ => continue,
                },
                // `import a = require("m")`
                Decl::ImportEquals(import) => match hir[import].target {
                    hir::ImportEqualsTarget::Require(spec) if spec.is_some() => {
                        match self.imported_file(file, spec).filter(|&imported| !self.exports_an_object(imported) && self.builtin_id(imported).is_none()) {
                            Some(imported) => {
                                let stands_for_all = self.c.atoms().intern(b"module.exports");
                                let is_exported = self.exports_of_file(imported).iter().any(|export| export.0 == stands_for_all);
                                if is_exported && self.files.export(self.files.file_symbol(imported), known::export_equals).is_none() {
                                    return ImportSource::Required(imported);
                                }
                                (spec, is_exported.then_some(stands_for_all))
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
            if name == Some(known::default) && self.text_imported_as(file, specifier).is_some() {
                return ImportSource::Text { file, specifier };
            }
            if self.type_told_to_the_host(file, specifier).is_some() {
                return if name == Some(known::default) { ImportSource::Text { file, specifier } } else { ImportSource::Unknown };
            }
            if matches!(self.asset_the_host_loads(file, specifier), Some(HostLoads::Manifest)) {
                return ImportSource::Unknown;
            }
            let is_asset = match decl {
                Decl::ImportDefault(import) | Decl::ImportNamespace(import) => self.is_import_of_asset(file, hir[import].stmt),
                Decl::ImportSpec(spec) => self.is_import_of_asset(file, hir[hir[spec].import].stmt),
                _ => false,
            };
            let is_asset = is_asset && (self.shared.bundle.is_none() || self.text_imported_as(file, specifier).is_some());
            let Some(imported) = self.imported_file(file, specifier).filter(|_| !is_asset) else {
                return ImportSource::External { specifier, name };
            };
            if self.exports_an_object(imported) {
                return ImportSource::ExportedObject { importer: file, file: imported, name };
            }
            return match name {
                Some(name) => match self.source_of_export(imported, name) {
                    ImportSource::Unknown if name != known::default => self.member_of_only_object_behind_stars(imported, name),
                    source => source,
                },
                None if is_deferred && self.shared.modules_deferred.contains(&imported) => ImportSource::DeferredNamespace(imported),
                None => ImportSource::Namespace(imported),
            };
        }
        ImportSource::Unknown
    }

    pub(crate) fn all_star_exports_resolve(&self, file: FileId) -> bool {
        let (mut seen, mut left) = (vec![file], vec![file]);
        while let Some(module) = left.pop() {
            for &star in &self.stars_of(module).list {
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

    pub(crate) fn only_object_behind_stars(&self, file: FileId) -> Option<(FileId, FileId)> {
        let (mut found, mut seen, mut left) = (None, vec![file], vec![file]);
        while let Some(module) = left.pop() {
            for &star in &self.stars_of(module).list {
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

    pub(crate) fn member_of_only_object_behind_stars(&self, file: FileId, name: Atom) -> ImportSource {
        let (mut found, mut seen, mut left) = (None, vec![file], vec![file]);
        while let Some(module) = left.pop() {
            if self.files.export(self.files.file_symbol(module), name).is_some() {
                return ImportSource::Unknown;
            }
            for &star in &self.stars_of(module).list {
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
        found.map_or(ImportSource::Unknown, |(importer, object)| ImportSource::ExportedObject { importer, file: object, name: Some(name) })
    }

    /// Where the value comes from that the ES module `file` of the program exports as `name`.
    fn source_of_export(&self, file: FileId, name: Atom) -> ImportSource {
        match self.export_of_module(file, name, &mut vec![file]) {
            ImportSource::Declaration(exported) if self.is_import(exported) => self.import_source(exported),
            source => source,
        }
    }

    /// The same, one step of it: an export of the module itself, which may be an import, or else of a module that it re-exports all of.
    /// `seen`: the modules that have been asked.
    fn export_of_module(&self, file: FileId, name: Atom, seen: &mut Vec<FileId>) -> ImportSource {
        if let Some(own) = self.files.export(self.files.file_symbol(file), name) {
            return ImportSource::Declaration(own);
        }
        if (name == known::default || self.c.atoms().bytes(name) == b"module.exports")
            && let Some(assigned) = self.files.export(self.files.file_symbol(file), known::export_equals)
        {
            return ImportSource::Declaration(assigned);
        }
        // `export *` leaves it out.
        if name == known::default {
            return ImportSource::Unknown;
        }
        let has_it = |module: Sym| self.files.module_export(module, name).is_some();
        // What a star of an ES module of the program has brought: another star may bring the same binding, and no other.
        let mut brought: Option<ImportSource> = None;
        for star in self.stars_of(file).that_may_bring(name) {
            match star {
                // What such a module exports is only known once it has run. Whether the name is among it is what the checker makes of it.
                Star::Object(imported) => {
                    if brought.is_none() && has_it(self.files.file_symbol(imported)) {
                        return ImportSource::ExportedObject { importer: file, file: imported, name: Some(name) };
                    }
                }
                Star::Module(imported) if seen.contains(&imported) => {}
                Star::Module(imported) => {
                    seen.push(imported);
                    let found = self.export_of_module(imported, name, seen);
                    match (brought, found) {
                        (_, ImportSource::Unknown) => {}
                        (None, _) => brought = Some(found),
                        (Some(first), _) if self.is_same_binding(first, found) => {}
                        _ => return ImportSource::Unknown,
                    }
                }
                Star::Outside(specifier) => {
                    if brought.is_none() && self.files.module_of_specifier(file, specifier).is_some_and(has_it) {
                        return ImportSource::External { specifier, name: Some(name) };
                    }
                }
            }
        }
        brought.unwrap_or(ImportSource::Unknown)
    }

    fn stars_of(&self, file: FileId) -> &'c Stars {
        self.shared.stars[file.idx()].get_or_init(|| {
            let mut stars = Stars { list: self.resolved_stars_of(file), ..Stars::default() };
            let mut names_through: FxHashMap<FileId, Option<Rc<FxHashSet<Atom>>>> = FxHashMap::default();
            names_through.insert(file, None);
            for (index, &star) in stars.list.iter().enumerate() {
                match star {
                    Star::Module(imported) => match self.names_exported_through(imported, &mut names_through) {
                        Some(names) => names.iter().for_each(|&name| stars.by_name.entry(name).or_default().push(index as u32)),
                        None => stars.for_any_name.push(index as u32),
                    },
                    Star::Object(_) | Star::Outside(_) => stars.for_any_name.push(index as u32),
                }
            }
            stars
        })
    }

    fn resolved_stars_of(&self, file: FileId) -> Vec<Star> {
        let resolved = |specifier: Atom| match self.imported_file(file, specifier) {
            Some(imported) if self.exports_an_object(imported) => Star::Object(imported),
            Some(imported) => Star::Module(imported),
            None => Star::Outside(specifier),
        };
        self.modules_exported_whole(file).into_iter().map(resolved).collect()
    }

    fn names_exported_through(&self, file: FileId, known: &mut FxHashMap<FileId, Option<Rc<FxHashSet<Atom>>>>) -> Option<Rc<FxHashSet<Atom>>> {
        if let Some(found) = known.get(&file) {
            return found.clone();
        }
        known.insert(file, None);
        let mut names: FxHashSet<Atom> = self.files.exports(self.files.file_symbol(file)).into_iter().map(|export| export.0).collect();
        let mut is_whole = true;
        for star in self.resolved_stars_of(file) {
            match star {
                Star::Module(imported) => match self.names_exported_through(imported, known) {
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
            ImportSource::Declaration(exported) if self.is_import(exported) => self.import_source(exported),
            source => source,
        };
        match (followed(a), followed(b)) {
            (ImportSource::Declaration(a), ImportSource::Declaration(b)) => a == b,
            (ImportSource::Namespace(a), ImportSource::Namespace(b)) | (ImportSource::DeferredNamespace(a), ImportSource::DeferredNamespace(b)) => a == b,
            (ImportSource::Entity(a), ImportSource::Entity(b)) => a == b,
            (ImportSource::ExportedObject { file: a, name: x, .. }, ImportSource::ExportedObject { file: b, name: y, .. }) => a == b && x == y,
            (ImportSource::External { specifier: a, name: x }, ImportSource::External { specifier: b, name: y }) => a == b && x == y,
            _ => false,
        }
    }

    /// `export * from "m"`: the specifiers, in order.
    fn modules_exported_whole(&self, file: FileId) -> Vec<Atom> {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let stars = bound.export_stars.iter().filter(|star| star.0 == bound.file_symbol);
        stars
            .filter_map(|star| match hir[star.1].kind {
                StmtKind::ExportStar { spec, type_only: false, .. } => Some(spec),
                _ => None,
            })
            .filter(|&specifier| !self.is_dropped_import(file, specifier))
            .collect()
    }

    /// What the ES module `file` of the program exports, but for what is only a type: each name, and where its value comes from.
    pub(crate) fn exports_of_file(&self, file: FileId) -> Vec<(Atom, ImportSource)> {
        let mut names = Vec::new();
        self.add_exported_names(file, false, &mut names, &mut FxHashSet::default(), &mut vec![file]);
        names.into_iter().map(|name| (name, self.source_of_export(file, name))).filter(|export| !matches!(export.1, ImportSource::Unknown)).collect()
    }

    fn is_exported_by_the_code_alone(&self, exported: Sym) -> bool {
        self.hir(exported.file).is_js
            && self.files.flags(exported).contains(SymFlags::ALIAS)
            && !self.files.means(exported, SymFlags::VALUE)
            && self.files.resolve_alias(exported).is_some_and(|target| {
                let declared = self.files.decls(target);
                declared.iter().any(|&(of, _)| self.hir(of).kind == FileKind::Declaration)
            })
    }

    /// `is_exported_whole`: by way of an `export *`, which leaves out `default`.
    fn add_exported_names(&self, file: FileId, is_exported_whole: bool, names: &mut Vec<Atom>, added: &mut FxHashSet<Atom>, seen: &mut Vec<FileId>) {
        let mut add = |name: Atom, exported: Sym, is_exported_whole: bool| {
            let flags = self.files.symbol_flags(exported);
            if (flags.intersects(SymFlags::VALUE) || self.is_exported_by_the_code_alone(exported))
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
        for specifier in self.modules_exported_whole(file) {
            let module = match self.imported_file(file, specifier) {
                Some(imported) if !self.exports_an_object(imported) => {
                    modules.push(imported);
                    continue;
                }
                // The names are what the checker makes of the module.
                Some(imported) => Some(self.files.file_symbol(imported)),
                None => self.files.module_of_specifier(file, specifier),
            };
            for &(name, exported) in module.map_or(&[][..], |module| self.files.exports_of_module(module)) {
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

    pub(crate) fn unproven_builtin_imports(&mut self, file: FileId, specifier: Atom) -> (&'static [u8], Vec<(Atom, bool)>) {
        let Some((module, known)) = known_builtin_exports(self.c.atoms().bytes(specifier)) else { return (b"", Vec::new()) };
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut unproven: Vec<(Atom, Atom)> = Vec::new();
        let mut kept: Vec<(Atom, bool)> = Vec::new();
        for export in hir.exports.iter().filter(|export| export.spec == specifier && !export.type_only) {
            let is_known = |name: Atom| known.binary_search_by(|probe| (*probe).cmp(self.c.atoms().bytes(name))).is_ok();
            kept.extend(export.items.iter().map(|item| &hir[item]).filter(|item| !item.type_only && !is_known(item.local)).map(|item| (item.local, true)));
        }
        let is_exported_again = |local: Atom| hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == local));
        for stmt in hir.ids(hir.body) {
            let StmtKind::Import(import) = hir[stmt].kind else { continue };
            if hir[import].spec != specifier || hir[import].type_only {
                continue;
            }
            let named = hir[import].named.iter().map(|spec| &hir[spec]).filter(|spec| !spec.type_only);
            let is_known = |name: Atom| known.binary_search_by(|probe| (*probe).cmp(self.c.atoms().bytes(name))).is_ok();
            unproven.extend(named.filter(|spec| !is_known(spec.imported)).map(|spec| (spec.imported, spec.local)));
        }
        let drops_unused_imports = !hir.is_js || self.shared.constants.own_paths.is_none();
        if unproven.is_empty() || !drops_unused_imports {
            kept.extend(unproven.into_iter().map(|(imported, local)| (imported, is_exported_again(local))));
            return (module, kept);
        }
        for (imported, local) in unproven {
            let is_exported = is_exported_again(local);
            let mut is_used = is_exported;
            for (index, node) in hir.exprs.iter().enumerate() {
                let e = hir::ExprId(index as u32);
                if is_used || !matches!(node.kind, hir::ExprKind::Ident(name) if name == local) || bound.expr_parent[index] == Parent::None || bound.is_in_type_query(e) {
                    continue;
                }
                let Some(sym) = self.c.binding_of_identifier(file, e, local) else { continue };
                is_used = self.is_import(sym);
            }
            if is_used {
                kept.push((imported, is_exported));
            }
        }
        (module, kept)
    }

    pub(crate) fn is_namespace_used_as_a_value(&mut self, importer: FileId, imported: FileId) -> bool {
        let (hir, bound) = (self.hir(importer), self.c.bound(importer));
        let names_it = |stmt: hir::StmtId| match hir[stmt].kind {
            StmtKind::Import(import) => hir[import].namespace.is_some() && !hir[import].type_only && self.imported_file(importer, hir[import].spec) == Some(imported),
            _ => false,
        };
        if !self.is_commonjs(imported) || !hir.ids(hir.body).any(names_it) {
            return false;
        }
        for (index, node) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = node.kind else { continue };
            let e = hir::ExprId(index as u32);
            let is_read_by_name = match bound.expr_parent[index] {
                Parent::Expr(read) if matches!(hir[read].kind, hir::ExprKind::Dot { obj, chain: hir::Chain::No, .. } if obj == e) => {
                    let mut top = read;
                    while let Parent::Expr(around) = bound.expr_parent[top.idx()]
                        && matches!(hir[around].kind, hir::ExprKind::As { .. } | hir::ExprKind::Satisfies { .. } | hir::ExprKind::NonNull(_))
                    {
                        top = around;
                    }
                    match bound.expr_parent[top.idx()] {
                        Parent::Expr(around) => match hir[around].kind {
                            hir::ExprKind::Call(call) | hir::ExprKind::New(call) | hir::ExprKind::TaggedTemplate(call) => hir[call].callee != top,
                            hir::ExprKind::Unary { op, .. } => !matches!(op, hir::UnOp::Delete | hir::UnOp::PreInc | hir::UnOp::PreDec | hir::UnOp::PostInc | hir::UnOp::PostDec),
                            hir::ExprKind::Assign { target, .. } => target != top,
                            hir::ExprKind::Instantiation { .. } | hir::ExprKind::AsConst(_) => false,
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
            let Some(sym) = self.c.binding_of_identifier(importer, e, name) else { continue };
            if self.is_import(sym) && matches!(self.import_source(sym), ImportSource::ExportedObject { file, name: None, .. } if file == imported) {
                return true;
            }
        }
        false
    }

    /// `ns` of `import * as ns from "./commonjs"`: who imports it, and the module.
    pub(crate) fn exported_object_imported_whole(&mut self, fx: &Fx, e: hir::ExprId) -> Option<(FileId, FileId)> {
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return None };
        let sym = self.c.binding_of_identifier(fx.file, e, name)?;
        match self.is_import(sym).then(|| self.import_source(sym))? {
            ImportSource::ExportedObject { importer, file, name: None } => Some((importer, file)),
            _ => None,
        }
    }

    pub(crate) fn entity_alias_declaration(&self, alias: Sym) -> Option<(FileId, hir::ImportEqualsId)> {
        self.files.decls(alias).into_iter().find_map(|(file, decl)| match decl {
            Decl::ImportEquals(import) if matches!(self.hir(file)[import].target, hir::ImportEqualsTarget::Entity(_)) => Some((file, import)),
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
        let Some((file, import)) = self.entity_alias_declaration(alias) else { return EntityAlias::TypeOnly };
        if !self.files.symbol_flags(alias).intersects(SymFlags::VALUE) {
            return EntityAlias::TypeOnly;
        }
        if self.reified_namespace_exporting(alias).is_some() {
            return EntityAlias::CopiedValue;
        }
        match self.alias_path_binding(file, import) {
            Some(binding) if self.is_immutable_binding(binding) && self.c.namespace_runs_before_import_equals(binding, file, import) => EntityAlias::SameBinding(binding),
            _ => EntityAlias::CopiedValue,
        }
    }

    fn is_immutable_binding(&mut self, binding: Sym) -> bool {
        match self.value_declaration(binding) {
            Some((_, Decl::Fn(_))) => !self.is_assigned(binding),
            Some((_, Decl::Class(_) | Decl::Enum(_) | Decl::EnumMember(_) | Decl::Module(_) | Decl::File)) => true,
            Some((_, Decl::Var(_))) => self.c.is_constant(binding) && self.namespace_with_property(binding).is_none(),
            _ => false,
        }
    }

    fn alias_path_binding(&mut self, file: FileId, import: hir::ImportEqualsId) -> Option<Sym> {
        let path = self.resolve_alias_path(file, import);
        match path.source {
            Some(ImportSource::Declaration(found) | ImportSource::Entity(found)) if path.resolved_count == path.names.len() => {
                let binding = self.value_symbol(found);
                (!self.is_ambient(binding)).then_some(binding)
            }
            _ => None,
        }
    }

    fn resolve_alias_path(&mut self, file: FileId, import: hir::ImportEqualsId) -> ResolvedAliasPath {
        let names: Vec<Atom> = match self.hir(file)[import].target {
            hir::ImportEqualsTarget::Entity(names) => self.hir(file).texts(names).collect(),
            hir::ImportEqualsTarget::Require(_) => Vec::new(),
        };
        let mut path = ResolvedAliasPath { source: None, names, resolved_count: 1, aliases_crossed: Vec::new() };
        let scope = self.c.bound(file).import_equals_scope[import.idx()];
        let Some(root) = path.names.first().and_then(|_| self.files.resolve_entity(file, scope, &path.names[..1], SymFlags::VALUE | SymFlags::NAMESPACE | SymFlags::ALIAS)) else { return path };
        path.source = Some(ImportSource::Declaration(root));
        while let Some(ImportSource::Declaration(found) | ImportSource::Entity(found)) = path.source {
            let holder = self.value_symbol_after(found, &mut path.aliases_crossed);
            if path.resolved_count == path.names.len() || self.is_ambient(holder) || self.exports_an_object(holder.file) {
                break;
            }
            let (name, flags) = (path.names[path.resolved_count], self.files.flags(holder));
            let next = if matches!(self.value_declaration(holder), Some((_, Decl::File))) {
                match self.source_of_export(holder.file, name) {
                    ImportSource::Unknown => match self.member_of_only_object_behind_stars(holder.file, name) {
                        ImportSource::Unknown => None,
                        source => Some(source),
                    },
                    ImportSource::Namespace(module) => Some(ImportSource::Declaration(self.files.file_symbol(module))),
                    source => Some(source),
                }
            } else if flags.intersects(SymFlags::ENUM) || flags.intersects(SymFlags::VALUE_MODULE) && !self.c.is_reified_namespace(holder) {
                self.files.export(holder, name).map(ImportSource::Declaration)
            } else {
                None
            };
            let Some(next) = next else { break };
            path.source = Some(next);
            path.resolved_count += 1;
        }
        path
    }

    fn read_alias_path(&mut self, fx: &mut Fx, file: FileId, import: hir::ImportEqualsId, pos: u32) -> V {
        let path = self.resolve_alias_path(file, import);
        for &crossed in &path.aliases_crossed {
            self.check_entity_alias_initialized(fx, crossed, hir::ExprId::NONE);
        }
        let mut value = match path.source {
            Some(ImportSource::Declaration(found) | ImportSource::Entity(found)) => self.read_binding(fx, Some(found), path.names[path.resolved_count - 1], None, pos, false),
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
        let variable = self.add_global(name, alias.file, Ty::NONE, GlobalKey::Symbol(alias.file, alias.id));
        let was = self.places.insert(alias, Place::Global(variable));
        if let Some(undo) = &mut self.undo {
            undo.places.push((alias, was));
        }
        variable
    }

    pub(crate) fn check_entity_alias_initialized(&mut self, fx: &mut Fx, alias: Sym, e: hir::ExprId) {
        let Some((of, import)) = self.entity_alias_declaration(alias) else { return };
        if matches!(self.entity_alias_kind(alias), EntityAlias::SameBinding(_)) && self.c.may_run_before_import_equals(of, import, fx.file, e) {
            let variable = self.entity_alias_global(alias);
            self.emit_throwing(fx, Op::GlobalGet(variable));
        }
    }

    pub(crate) fn read_entity_alias(&mut self, fx: &mut Fx, alias: Sym, e: hir::ExprId) -> V {
        if let Some(namespace) = self.reified_namespace_exporting(alias) {
            return self.read_property_of_namespace(fx, namespace, alias);
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
        fx.b.func.values[found.idx()].set_finds_initialized(true);
        found
    }

    fn starts_with_named_import(&mut self, file: FileId, import: hir::ImportEqualsId) -> bool {
        let hir::ImportEqualsTarget::Entity(names) = self.hir(file)[import].target else { return false };
        let names: Vec<Atom> = self.hir(file).texts(names).collect();
        let scope = self.c.bound(file).import_equals_scope[import.idx()];
        let root = names.first().and_then(|_| self.files.resolve_entity(file, scope, &names[..1], SymFlags::VALUE | SymFlags::NAMESPACE | SymFlags::ALIAS));
        root.is_some_and(|root| self.files.decls(root).into_iter().any(|(_, decl)| matches!(decl, Decl::ImportSpec(_) | Decl::ImportDefault(_))))
    }

    pub(crate) fn emit_entity_alias(&mut self, fx: &mut Fx, import: hir::ImportEqualsId, pos: u32) {
        let file = fx.file;
        let Some((alias, is_referenced)) = self.c.import_equals_symbol(file, import) else { return };
        let kind = self.entity_alias_kind(alias);
        if matches!(kind, EntityAlias::TypeOnly) || !is_referenced && !self.starts_with_named_import(file, import) {
            return;
        }
        if let EntityAlias::SameBinding(binding) = kind {
            let path = self.resolve_alias_path(file, import);
            for &crossed in &path.aliases_crossed {
                self.check_entity_alias_initialized(fx, crossed, hir::ExprId::NONE);
            }
            if matches!(self.value_declaration(binding), Some((_, Decl::Var(_) | Decl::Class(_)))) && self.may_be_in_dead_zone(fx, binding, hir::ExprId::NONE) {
                self.read_sym(fx, binding, pos);
            }
            let (variable, marker) = (self.entity_alias_global(alias), self.emit(fx, Op::Undefined));
            self.emit(fx, Op::GlobalSet(variable, marker));
            return;
        }
        let value = self.read_alias_path(fx, file, import, pos);
        let Some(namespace) = self.reified_namespace_exporting(alias) else {
            let variable = self.entity_alias_global(alias);
            self.emit(fx, Op::GlobalSet(variable, value));
            return;
        };
        let member = self.files.symbol(alias).name;
        if let Some(holder) = self.layout_of_namespace(namespace).and_then(|layout| self.layout_types.get(&layout).copied()) {
            match self.alias_path_binding(file, import).and_then(|binding| self.function_declared_as(binding)) {
                Some((of, func)) => self.c.note_callee_declared(holder, member, of, func),
                None => self.c.note_unknown_callee(holder, member, file, pos),
            }
        }
        let obj = self.namespace_object(fx, namespace);
        let name = self.str(member);
        self.emit_throwing(fx, Op::PropSet { obj, name, value });
    }

    /// The value of an import that no binding of the program holds. It is read on each use, which keeps it live.
    pub(crate) fn read_import(&mut self, fx: &mut Fx, source: ImportSource, pos: u32) -> V {
        let (namespace, name) = match source {
            ImportSource::Text { file, specifier } => {
                let text = self.text_imported_as(file, specifier).unwrap_or_default();
                return self.emit_value_of_asset(fx, file, specifier, text);
            }
            ImportSource::External { specifier, name: None } if self.c.atoms().bytes(specifier) == b"bun" => {
                let bun = self.out.strs.intern(b"Bun");
                return self.emit_throwing(fx, Op::FreeGet { name: bun, is_typeof: false });
            }
            ImportSource::External { specifier, name } => (self.external_module(fx, specifier), name),
            ImportSource::ExportedObject { importer, file, name: Some(name) } => {
                let name = self.c.atoms().bytes(name);
                return self.member_of_exported_object(fx, importer, file, name);
            }
            ImportSource::ExportedObject { importer, file, name: None } => (self.namespace_of_exported_object(fx, importer, file), None),
            ImportSource::DeferredNamespace(file) => return self.deferred_namespace_object(fx, file),
            ImportSource::Required(file) => return self.what_require_has_yielded(fx, file),
            _ if self.report_unknown_runtime_helpers(fx.file) => return self.emit(fx, Op::Undefined),
            _ => return self.unsupported(fx, pos, "an import of a name that the module does not export"),
        };
        match name {
            Some(name) => {
                let name = self.str(name);
                self.emit_throwing(fx, Op::PropGet { obj: namespace, name })
            }
            None => namespace,
        }
    }
}
