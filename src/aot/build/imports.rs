//! Imports: which code an import stands for.
//!
//! Every import is resolved twice. The checker resolves it for its types, as `bun check` does: `react` is `@types/react/index.d.ts`.
//! The bundler resolves it for the code that runs: `react/index.js`. The symbol the checker has for an imported name says what type
//! its value is of. The value is what the bundler's file exports under that name. Nothing here follows the checker from one module
//! to the next: an import, a re-export and `export *` all go where the bundler has them go.

use super::{FileBuild, Fx};
use crate::id::V;
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
    /// `import a = b.c`: what the checker has `b.c` stand for.
    Entity,
    /// A property of what a CommonJS or JSON module exports, as an ES module sees it. No name: all of it.
    ExportedObject { importer: FileId, file: FileId, name: Option<Atom> },
    /// A module that is not compiled with the program.
    External { specifier: Atom, name: Option<Atom> },
    /// The default export of a file that is imported as a string, which `file` imports as `specifier`.
    Text { file: FileId, specifier: Atom },
    Unknown,
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
    dropped: FxHashSet<(FileId, &'p [u8])>,
    /// See `FileBuild::only_declares`.
    declaring: FxHashSet<FileId>,
}

impl<'p> Bundle<'p> {
    /// `None`: there is no bundler.
    pub(crate) fn new(files: &Files<'_>, roots: &[FileId], constants: &'p crate::Constants) -> Option<Bundle<'p>> {
        let mut resolved: FxHashMap<(FileId, &'p [u8]), (&'p [u8], Option<FileId>)> = FxHashMap::default();
        for ((from, specifier), to) in constants.resolved.as_ref()? {
            let Some(from) = files.by_path.get(from) else { continue };
            let printed = files.by_path.get(to);
            let code = printed.map(|printed| written_in_the_place_of(files, printed));
            let found = (if code == printed { to.as_slice() } else { &to[..to.len() - b".js".len()] }, code);
            // Two paths can be one file of the program. Then it is the lesser one, in whichever order they come here.
            let known = resolved.entry((from, specifier.as_slice())).or_insert(found);
            if found.0 < known.0 {
                *known = found;
            }
        }
        let dropped = (constants.dropped_imports.iter())
            .filter_map(|(from, specifier)| Some((files.by_path.get(from)?, specifier.as_slice())))
            .collect();
        let mut bundle = Bundle { resolved, dropped, declaring: FxHashSet::default() };
        bundle.declaring = bundle.files_that_only_declare(files, roots);
        Some(bundle)
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
        let imported = match &self.shared.bundle {
            Some(bundle) => bundle.resolved.get(&(file, text))?.1?,
            None => self.file_resolved_by_checker(file, specifier)?,
        };
        (!self.only_declares(imported)).then_some(imported)
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

    pub(crate) fn asset_the_host_loads(&self, file: FileId, specifier: Atom) -> Option<HostLoads> {
        let path = self.shared.bundle.as_ref()?.resolved.get(&(file, self.c.atoms().bytes(specifier)))?.0;
        self.shared.constants.assets.get(path)?;
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
        self.value_symbol_after(sym, &mut Vec::new())
    }

    /// `seen`: see `value_symbol_of_export_after`.
    pub(crate) fn value_symbol_after(&mut self, sym: Sym, seen: &mut Vec<Sym>) -> Sym {
        let mut sym = sym;
        if self.is_import(sym) {
            match self.import_source(sym) {
                ImportSource::Declaration(exported) => return self.value_symbol_of_export_after(exported, seen),
                ImportSource::Namespace(file) => return self.files.file_symbol(file),
                ImportSource::Entity => {}
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
        match self.source_of_export(file, name) {
            ImportSource::Declaration(exported) => {
                let member = self.value_symbol_of_export(exported);
                !self.has_value_at_run_time(member)
            }
            ImportSource::Unknown => self.re_exports_modules_of_the_program_alone(file, &mut vec![file]),
            _ => false,
        }
    }

    /// Not a type or what is only declared.
    pub(crate) fn has_value_at_run_time(&self, member: Sym) -> bool {
        let flags = self.files.flags(member);
        flags.intersects(SymFlags::VALUE) && !self.is_ambient(member)
    }

    fn re_exports_modules_of_the_program_alone(&self, file: FileId, seen: &mut Vec<FileId>) -> bool {
        self.modules_exported_whole(file).into_iter().all(|specifier| match self.imported_file(file, specifier) {
            Some(imported) if self.exports_an_object(imported) => false,
            Some(imported) if seen.contains(&imported) => true,
            Some(imported) => {
                seen.push(imported);
                self.re_exports_modules_of_the_program_alone(imported, seen)
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
                                (spec, self.exports_of_file(imported).iter().any(|export| export.0 == stands_for_all).then_some(stands_for_all))
                            }
                            None => (spec, Some(known::default)),
                        }
                    }
                    _ => return ImportSource::Entity,
                },
                _ => continue,
            };
            if name == Some(known::default) && self.text_imported_as(file, specifier).is_some() {
                return ImportSource::Text { file, specifier };
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
                None => ImportSource::Namespace(imported),
            };
        }
        ImportSource::Unknown
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

    fn member_of_only_object_behind_stars(&self, file: FileId, name: Atom) -> ImportSource {
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
            (ImportSource::Namespace(a), ImportSource::Namespace(b)) => a == b,
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

    /// `is_exported_whole`: by way of an `export *`, which leaves out `default`.
    fn add_exported_names(&self, file: FileId, is_exported_whole: bool, names: &mut Vec<Atom>, added: &mut FxHashSet<Atom>, seen: &mut Vec<FileId>) {
        let mut add = |name: Atom, exported: Sym, is_exported_whole: bool| {
            let flags = self.files.symbol_flags(exported);
            if flags.intersects(SymFlags::VALUE)
                && name != known::export_equals
                && !(is_exported_whole && name == known::default)
                && added.insert(name)
            {
                names.push(name);
            }
        };
        for (name, exported) in self.files.exports(self.files.file_symbol(file)) {
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

    /// The value of an import that no binding of the program holds. It is read on each use, which keeps it live.
    pub(crate) fn read_import(&mut self, fx: &mut Fx, source: ImportSource, pos: u32) -> V {
        let (namespace, name) = match source {
            ImportSource::Text { file, specifier } => {
                let text = self.text_imported_as(file, specifier).unwrap_or_default();
                return self.emit_value_of_asset(fx, file, specifier, text);
            }
            ImportSource::External { specifier, name } => (self.external_module(fx, specifier), name),
            ImportSource::ExportedObject { importer, file, name: Some(name) } => {
                let name = self.c.atoms().bytes(name);
                return self.member_of_exported_object(fx, importer, file, name);
            }
            ImportSource::ExportedObject { importer, file, name: None } => (self.namespace_of_exported_object(fx, importer, file), None),
            _ => return self.unsupported(fx, pos, "an import of what the module does not export"),
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
