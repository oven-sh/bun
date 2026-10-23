//! Which imports of a checked file Bun loads as an HTML page.
//!
//! Bun decides that for each import: by the loader that the import's `type` attribute names, or else by the loader of
//! the file's extension (`bun_ast::Loader::of_extension`). So `import text from "./page.html" with { type: "text" }` is
//! a string, and `import page from "./page.tmpl" with { type: "html" }` is a page. A page stands for its scripts,
//! which `Host::scripts_of_page` names.
//!
//! Only an import that is written as a path is followed. Where any other specifier leads is for Bun's resolver to
//! say. A bundle has asked it, and names the scripts of its pages itself: see `Request::loaders`.

use bun_ast::{Loader, LoaderHashTable};
use bun_paths::fs::PathName;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExprId, ExprKind, SpecifierKind, skip_assertions};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Host, is_relative, join};
use bun_sema::util::{FxHashSet, SharedSort};

/// Finds the pages that the files of one program import.
pub(crate) struct Pages<'a, 's> {
    host: &'a dyn Host,
    files: &'a Files<'s>,
    /// `Request::loaders`
    loaders: &'a LoaderHashTable,
    /// `--loader :html`: a file without an extension is a page.
    is_page_without_extension: bool,
    /// The extensions that `loaders` gives the HTML loader, except `.html`.
    other_page_extensions: Vec<&'a [u8]>,
    /// The real paths of the pages whose scripts `scripts_imported_by` has returned.
    followed: FxHashSet<Vec<u8>>,
}

/// A specifier of one file that can name a page, and what its uses in the file say.
struct Import {
    specifier: Atom,
    /// The extension that is written in the specifier is a page's.
    has_page_extension: bool,
    /// A use names the HTML loader.
    names_html: bool,
    /// A use names no loader, so Bun takes the loader of the file's extension.
    names_nothing: bool,
}

/// The `with` clauses and the `import()` options of one file, by the position of the specifier they belong to. Made
/// for the first use that asks.
#[derive(Default)]
struct Attributes {
    /// Each `import` declaration, from its first token to its end. Sorted.
    declarations: Option<Vec<(u32, u32)>>,
    /// The second argument of each `import()` that has one, by the position of the first. Sorted.
    options: Option<Vec<(u32, ExprId)>>,
}

impl<'a, 's> Pages<'a, 's> {
    pub(crate) fn new(
        host: &'a dyn Host,
        files: &'a Files<'s>,
        loaders: &'a LoaderHashTable,
    ) -> Self {
        let of_pages = loaders.iter().filter(|it| *it.1 == Loader::Html);
        let of_pages = of_pages.map(|it| &it.0[..]);
        Pages {
            host,
            files,
            loaders,
            is_page_without_extension: Loader::of_extension(b"", loaders) == Some(Loader::Html),
            other_page_extensions: of_pages.filter(|it| *it != b".html").collect(),
            followed: FxHashSet::default(),
        }
    }

    /// The scripts of the pages that `file` imports. A page's scripts are returned once per program.
    pub(crate) fn scripts_imported_by(&mut self, file: FileId) -> Vec<Vec<u8>> {
        let module = self.files.module(file);
        let hir = &module.hir;
        // A `type` attribute makes a page of a file with any name.
        let mut clauses = hir.import_attributes.iter();
        let names_html = clauses.any(|it| self.loader_named_in(hir, it.1) == Some(Loader::Html));
        let mut imports = Vec::new();
        for &specifier in module.bound.specifiers.iter() {
            let written = self.files.atoms.bytes(specifier);
            let has_page_extension = self.has_page_extension(written);
            if (has_page_extension || names_html) && is_relative(written) {
                imports.push(Import {
                    specifier,
                    has_page_extension,
                    names_html: false,
                    names_nothing: false,
                });
            }
        }
        if imports.is_empty() {
            return Vec::new();
        }
        self.read_attributes(hir, &mut imports);
        let directory = dirname::<Posix>(module.file_name());
        let mut scripts = Vec::new();
        for import in &imports {
            let is_named_by_extension = import.names_nothing && import.has_page_extension;
            if !import.names_html && !is_named_by_extension {
                continue;
            }
            let written = join(directory, self.files.atoms.bytes(import.specifier));
            if !self.host.is_file(&written) {
                continue;
            }
            // Bun's resolver returns the real path, and takes the loader of that.
            let real = self.host.realpath(&written);
            if !import.names_html && !self.has_page_extension(&real) {
                continue;
            }
            let page = self.in_spelling_of(&written, &real);
            if self.followed.insert(real) {
                scripts.extend(self.host.scripts_of_page(&page));
            }
        }
        scripts
    }

    /// True if Bun loads a file at `path` as a page, unless the import says otherwise. `Path::loader` in
    /// src/resolver/lib.rs takes the extension the same way: `.html` is the extension of a file named `.html`.
    fn has_page_extension(&self, path: &[u8]) -> bool {
        if !self.can_end_like_a_page(path) {
            return false;
        }
        match PathName::init(path).ext {
            b"" => self.is_page_without_extension,
            extension => Loader::of_extension(extension, self.loaders) == Some(Loader::Html),
        }
    }

    /// False for nearly every specifier of a program, after a byte or two compared: `path` ends with no extension
    /// that a page can have.
    fn can_end_like_a_page(&self, path: &[u8]) -> bool {
        let ends_with = |end: &[u8]| {
            let start = path.len().checked_sub(end.len());
            start.is_some_and(|start| path[start..].eq_ignore_ascii_case(end))
        };
        ends_with(b".html")
            || self.is_page_without_extension
            || self.other_page_extensions.iter().any(|it| ends_with(it))
    }

    /// The path to read the page at `real` by, which `written` names. The scripts of a page are relative to its real
    /// folder. The files of the program have the names they were found by, so the page keeps the spelling of the
    /// folder it was found in, as long as it is at or below that folder: a project can be named through a link.
    fn in_spelling_of(&self, written: &[u8], real: &[u8]) -> Vec<u8> {
        if written == real {
            return real.to_vec();
        }
        let folder = dirname::<Posix>(written);
        let below = real.strip_prefix(&self.host.realpath(folder)[..]);
        match below.and_then(|it| it.strip_prefix(b"/")) {
            Some(below) => join(folder, below),
            None => real.to_vec(),
        }
    }

    /// Reads the `type` attribute of every use of `imports` in the file, in one pass over its specifiers.
    fn read_attributes(&self, hir: &hir::File<'s>, imports: &mut [Import]) {
        imports.shared_sort_unstable_by_key(|it| it.specifier.0);
        let mut attributes = Attributes::default();
        for specifier_use in hir.specifier_uses.iter() {
            let found = imports.binary_search_by_key(&specifier_use.spec.0, |it| it.specifier.0);
            let Ok(at) = found else {
                continue;
            };
            // As Bun's parser reads it: after the specifier of an `import` declaration, and in the options of an
            // `import()`. It reads none after `export .. from`.
            let clause = match specifier_use.kind {
                SpecifierKind::Import | SpecifierKind::SideEffect => {
                    attributes.of_declaration(hir, specifier_use.pos)
                }
                SpecifierKind::ImportCall => attributes
                    .of_import_call(hir, specifier_use.pos)
                    .and_then(|options| self.with_in(hir, options)),
                _ => None,
            };
            match clause.and_then(|it| self.loader_named_in(hir, it)) {
                Some(Loader::Html) => imports[at].names_html = true,
                Some(_) => {}
                None => imports[at].names_nothing = true,
            }
        }
    }

    /// The value of `with` in the options of an `import()`. The runtime evaluates the options, so only a literal is
    /// known here.
    fn with_in(&self, hir: &hir::File<'s>, options: ExprId) -> Option<ExprId> {
        let ExprKind::Object(options) = hir[skip_assertions(hir, options)].kind else {
            return None;
        };
        let mut options = options.iter().map(|it| hir[it]);
        let with = options.find(|it| self.is_named(it.key, b"with"))?;
        Some(with.value)
    }

    /// The loader that `type` names in `clause`, the object after `with`. A name that no loader has is ignored.
    fn loader_named_in(&self, hir: &hir::File<'s>, clause: ExprId) -> Option<Loader> {
        let ExprKind::Object(attributes) = hir[skip_assertions(hir, clause)].kind else {
            return None;
        };
        let attributes = attributes.iter().rev().map(|it| hir[it]);
        let mut types = attributes.filter(|it| self.is_named(it.key, b"type"));
        types.find_map(|it| match hir[skip_assertions(hir, it.value)].kind {
            ExprKind::String(name) => Loader::from_string(self.files.atoms.bytes(name)),
            _ => None,
        })
    }

    fn is_named(&self, key: hir::PropKey, name: &[u8]) -> bool {
        matches!(key, hir::PropKey::Name(key) if self.files.atoms.bytes(key) == name)
    }
}

impl Attributes {
    /// The `with` clause of the `import` declaration whose specifier is at `specifier`.
    fn of_declaration(&mut self, hir: &hir::File, specifier: u32) -> Option<ExprId> {
        let clauses = &hir.import_attributes[..];
        if clauses.is_empty() {
            return None;
        }
        let declarations = self.declarations.get_or_insert_with(|| {
            let declarations = hir.imports.iter().filter(|it| it.stmt.is_some());
            let mut ranges: Vec<(u32, u32)> = declarations
                .map(|it| (hir[it.stmt].start, hir[it.stmt].loc.end))
                .collect();
            ranges.shared_sort_unstable_by_key(|it| it.0);
            ranges
        });
        let before = declarations.partition_point(|it| it.0 <= specifier);
        let &(_, end) = declarations[..before]
            .last()
            .filter(|it| specifier < it.1)?;
        let clause = clauses.get(clauses.partition_point(|it| it.0 <= specifier))?;
        (clause.0 < end).then_some(clause.1)
    }

    /// The second argument of the `import()` whose first argument is at `specifier`.
    fn of_import_call(&mut self, hir: &hir::File, specifier: u32) -> Option<ExprId> {
        let options = self.options.get_or_insert_with(|| {
            let calls = hir.exprs.iter().filter_map(|it| match it.kind {
                ExprKind::ImportCall { args, .. } => {
                    let mut args = hir.ids::<ExprId>(args);
                    Some((hir[args.next()?].pos, args.next()?))
                }
                _ => None,
            });
            let mut options: Vec<(u32, ExprId)> = calls.collect();
            options.shared_sort_unstable_by_key(|it| it.0);
            options
        });
        let at = options.binary_search_by_key(&specifier, |it| it.0).ok()?;
        Some(options[at].1)
    }
}
