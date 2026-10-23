//! Which imports of a checked file Bun loads as an HTML page, and where each page is.
//!
//! Bun decides that for each import, from the loader that the import's `type` attribute names, or else from the
//! loader of the file that the specifier resolves to (`bun_ast::Loader::of_extension`). What the specifier looks like
//! decides nothing: `import text from "./page.html" with { type: "text" }` is a string, and
//! `import page from "./page.tmpl" with { type: "html" }` is a page. A page stands for its scripts, which
//! `Host::scripts_of_page` names.

use crate::PageRules;
use bun_ast::Loader;
use bun_core::strings;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExprId, ExprKind, ResolutionMode, SpecifierKind, SpecifierUse};
use bun_sema::program::{FileId, Files, Module};
use bun_sema::resolve::{AsRequire, Host, Resolver, is_relative, join};
use bun_sema::session::Session;
use bun_sema::util::FxHashSet;
use std::cell::{Cell, OnceCell};

/// Finds the pages that the files of one program import.
pub(crate) struct Pages<'a, 's> {
    host: &'a dyn Host,
    files: &'a Files<'s>,
    rules: PageRules<'a>,
    /// Owns what `resolver` caches.
    resolving: &'a Session,
    /// Locates what a specifier that isn't a path names. Made for the first such specifier that TypeScript binds to no
    /// file: the resolver that loaded the program is gone, and most programs need none here.
    resolver: OnceCell<Resolver<'a>>,
    /// The pages whose scripts `scripts_imported_by` has returned.
    followed: FxHashSet<Vec<u8>>,
    /// `is_beside_page` of each file of the program, once it was asked. Many files import the same file.
    beside_page: Vec<Cell<Option<bool>>>,
}

/// What the `type` attributes of the uses of one specifier say about its loader.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Named {
    /// One use names the HTML loader.
    Html,
    /// Every use names a loader, and none of them is the HTML loader.
    Other,
    /// At least one use names no loader, so Bun takes the loader of the file.
    Nothing,
}

impl<'a, 's> Pages<'a, 's> {
    pub(crate) fn new(
        host: &'a dyn Host,
        files: &'a Files<'s>,
        rules: PageRules<'a>,
        resolving: &'a Session,
    ) -> Self {
        Pages {
            host,
            files,
            rules,
            resolving,
            resolver: OnceCell::new(),
            followed: FxHashSet::default(),
            beside_page: vec![Cell::new(None); files.modules.len()],
        }
    }

    /// The scripts of the pages that `file` imports. A page's scripts are returned once per program.
    pub(crate) fn scripts_imported_by(&mut self, file: FileId) -> Vec<Vec<u8>> {
        let module = self.files.module(file);
        let attributes = module.hir.import_attributes.iter();
        let names_html = attributes
            .map(|it| self.loader_named_in(&module.hir, it.1))
            .any(|it| it == Some(Loader::Html));
        let mut scripts = Vec::new();
        for &specifier in module.bound.specifiers.iter() {
            let Some(page) = self.page_of(module, specifier, names_html) else {
                continue;
            };
            if self.followed.contains(&page) {
                continue;
            }
            // As for a page of a bundle (`type_check` in src/bundler/bundle_v2.rs): what is installed is not checked
            // for the page's sake.
            let of_page = self.host.scripts_of_page(&page).into_iter();
            scripts.extend(of_page.filter(|it| !strings::contains(it, b"/node_modules/")));
            self.followed.insert(page);
        }
        scripts
    }

    /// The real path of the file that Bun loads as a page for `specifier` in `module`, if it loads one.
    /// `names_html`: a `type` attribute in `module` names the HTML loader.
    fn page_of(&self, module: &Module<'s>, specifier: Atom, names_html: bool) -> Option<Vec<u8>> {
        // What TypeScript binds to a file of the program is what Bun loads too, so it is no page, unless that file
        // stands beside the page for its types (`index.html.d.ts`). Otherwise the types come from a
        // `declare module "*.html"` or from nowhere, and Bun can still find a file.
        let may_be_page = match self.bound_file(module, specifier) {
            Some(bound) => self.is_beside_page(bound),
            None => !self.is_no_file(module, specifier),
        };
        if !may_be_page && !names_html {
            return None;
        }
        let named = self.named_by_uses(module, specifier);
        match named {
            Named::Html => {}
            Named::Nothing if may_be_page => {}
            Named::Nothing | Named::Other => return None,
        }
        let found = self.locate(module, self.files.atoms.bytes(specifier))?;
        // Bun's resolver returns the real path, and the scripts of a page are relative to it.
        let real = self.host.realpath(&found);
        let is_page = named == Named::Html || self.is_page_extension(bun_paths::extension(&real));
        is_page.then_some(real)
    }

    /// The file of the program that TypeScript resolves `specifier` to in `module`.
    fn bound_file(&self, module: &Module<'s>, specifier: Atom) -> Option<FileId> {
        let in_mode = |mode| module.imports.get(&(specifier, mode)).copied();
        // A plain `import` is resolved in the first mode, so one lookup finds most.
        in_mode(module.default_mode)
            .or_else(|| in_mode(ResolutionMode::Import))
            .or_else(|| in_mode(ResolutionMode::Require))
            .or_else(|| in_mode(ResolutionMode::None))
    }

    /// True if `file` stands beside a page for its types: TypeScript finds `./index.html` in `index.html.ts`,
    /// `index.html.d.ts` and `index.d.html.ts`, and Bun loads `index.html`.
    fn is_beside_page(&self, file: FileId) -> bool {
        let known = &self.beside_page[file.idx()];
        known.get().unwrap_or_else(|| {
            let name = self.files.module(file).file_name();
            let is_beside_page = self.is_page_extension(stood_for_extension(name));
            known.set(Some(is_beside_page));
            is_beside_page
        })
    }

    /// True if `specifier`, which TypeScript binds to no file of the program, is known to be no page without a look at
    /// the disk. It has a scheme (`node:fs`). Or it is declared by name (`declare module "bun"`) or is JavaScript that
    /// the program leaves out, and its own extension is not a page's.
    fn is_no_file(&self, module: &Module<'s>, specifier: Atom) -> bool {
        let text = self.files.atoms.bytes(specifier);
        if !is_relative(text) && strings::contains_char(text, b':') {
            return true;
        }
        let is_known = module.untyped_imports.iter().any(|it| it.0 == specifier)
            || self.files.try_find_ambient_module(specifier).is_some();
        is_known && !self.is_page_extension(bun_paths::extension(text))
    }

    /// True if Bun loads a file with this extension as a page, unless the import says otherwise.
    fn is_page_extension(&self, extension: &[u8]) -> bool {
        !extension.is_empty()
            && Loader::of_extension(extension, self.rules.loaders) == Some(Loader::Html)
    }

    /// Reads the `type` attribute of every use of `specifier` in `module`.
    fn named_by_uses(&self, module: &Module<'s>, specifier: Atom) -> Named {
        let hir = &module.hir;
        let uses = hir.specifier_uses.iter().filter(|it| it.spec == specifier);
        let mut named = Named::Other;
        let mut is_used = false;
        for specifier_use in uses {
            is_used = true;
            match self.loader_named_by(hir, specifier_use) {
                Some(Loader::Html) => return Named::Html,
                Some(_) => {}
                None => named = Named::Nothing,
            }
        }
        match is_used {
            true => named,
            false => Named::Nothing,
        }
    }

    /// The loader that the `type` attribute of one import names, as Bun's parser reads it: after the specifier of an
    /// `import` declaration, and in the options of an `import()`. It reads none after `export .. from`.
    fn loader_named_by(&self, hir: &hir::File<'s>, specifier_use: &SpecifierUse) -> Option<Loader> {
        match specifier_use.kind {
            SpecifierKind::Import | SpecifierKind::SideEffect => {
                if hir.import_attributes.is_empty() {
                    return None;
                }
                let is_around = |loc: &hir::TextRange, at: u32| (loc.pos..loc.end).contains(&at);
                let declarations = hir.imports.iter();
                let declarations = declarations.filter(|it| it.stmt.is_some());
                let mut declarations = declarations.map(|it| hir[it.stmt].loc);
                let declaration = declarations.find(|it| is_around(it, specifier_use.pos))?;
                let mut attributes = hir.import_attributes.iter();
                let attributes = attributes.find(|it| is_around(&declaration, it.0))?;
                self.loader_named_in(hir, attributes.1)
            }
            SpecifierKind::ImportCall => {
                let arguments = hir.exprs.iter().find_map(|it| match it.kind {
                    ExprKind::ImportCall { args } => Some(args).filter(|&args| {
                        let first = hir.ids(args).next();
                        first.is_some_and(|first: ExprId| hir[first].pos == specifier_use.pos)
                    }),
                    _ => None,
                })?;
                let ExprKind::Object(options) = hir[hir.ids(arguments).nth(1)?].kind else {
                    return None;
                };
                let option = |name: &[u8]| {
                    let mut options = options.iter().map(|it| hir[it]);
                    options.find(|it| self.is_named(it.key, name))
                };
                self.loader_named_in(hir, option(b"with").or_else(|| option(b"assert"))?.value)
            }
            SpecifierKind::Require | SpecifierKind::ImportType | SpecifierKind::RequireCall => None,
        }
    }

    /// The loader that `type` names in `attributes`, the object after `with`. A name that no loader has is ignored.
    fn loader_named_in(&self, hir: &hir::File<'s>, attributes: ExprId) -> Option<Loader> {
        let ExprKind::Object(attributes) = hir[attributes].kind else {
            return None;
        };
        let attributes = attributes.iter().rev().map(|it| hir[it]);
        let mut types = attributes.filter(|it| self.is_named(it.key, b"type"));
        types.find_map(|it| match hir[it.value].kind {
            ExprKind::String(name) => Loader::from_string(self.files.atoms.bytes(name)),
            _ => None,
        })
    }

    fn is_named(&self, key: hir::PropKey, name: &[u8]) -> bool {
        matches!(key, hir::PropKey::Name(key) if self.files.atoms.bytes(key) == name)
    }

    /// The file that `specifier` names in `module` the way Bun's resolver finds it, before links are followed.
    fn locate(&self, module: &Module<'s>, specifier: &[u8]) -> Option<Vec<u8>> {
        let from = module.file_name();
        if is_relative(specifier) {
            let written = join(dirname::<Posix>(from), specifier);
            return self.host.is_file(&written).then_some(written);
        }
        let resolver = self.resolver.get_or_init(|| {
            Resolver::for_few_lookups(self.resolving, self.host, self.files.options)
        });
        let (resolver, from) = resolver.redirect_for_resolution(from);
        let base_url = &resolver.options().base_url[..];
        let how = AsRequire {
            extensions: &[],
            module_directories: &[b"node_modules"],
            paths: &[],
            through_paths: true,
            as_import: true,
            base_url: Some(base_url).filter(|it| !it.is_empty()),
            conditions: self.rules.conditions,
        };
        Some(resolver.resolve_as_require(specifier, from, &how)?.0)
    }
}

/// The extension of the file that `stand_in` has the types of, going by its name: `.html` for `index.html.ts`,
/// `index.html.d.ts` and `index.d.html.ts`. Empty for `index.ts`.
fn stood_for_extension(stand_in: &[u8]) -> &[u8] {
    let without_own = &stand_in[..stand_in.len() - bun_paths::extension(stand_in).len()];
    bun_paths::extension(without_own.strip_suffix(b".d").unwrap_or(without_own))
}
