#![allow(dead_code, unused_imports)]

pub(crate) use bun_sema::atom::{Atom, Interner, known};
pub(crate) use bun_sema::hir::*;
pub(crate) use bun_sema::session::{Arena, Session};
pub(crate) use bun_sema_parser::{CompileParseOptions, parse_for_compile, summarize};

use bun_sema_standalone::{for_each_parallel, native};
use bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE;
use std::borrow::Cow;
use std::path::PathBuf;

const STACK_SIZE: usize = DEFAULT_THREAD_STACK_SIZE as usize;
const STACK_RESERVE: usize = 256 << 10;
const MIN_PROGRAM_COUNT: usize = 1_000;
const DECLARATION_EXTENSIONS: [&str; 3] = [".d.ts", ".d.mts", ".d.cts"];

pub(crate) const JAVASCRIPT_EXTENSIONS: [&str; 4] = [".js", ".jsx", ".mjs", ".cjs"];
pub(crate) const SOURCE_EXTENSIONS: [&str; 8] =
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

#[derive(Copy, Clone)]
pub(crate) struct Workspace<'s> {
    pub(crate) atoms: Interner<'s>,
    pub(crate) arena: &'s Arena,
}

#[derive(Copy, Clone)]
pub(crate) struct Source<'a> {
    pub(crate) path: &'a str,
    pub(crate) text: &'a [u8],
    pub(crate) experimental_decorators: bool,
    pub(crate) reads_jsdoc: bool,
    pub(crate) keeps_function_directives: bool,
}

impl<'a> Source<'a> {
    pub(crate) fn new(path: &'a str, text: &'a str) -> Source<'a> {
        Source::from_bytes(path, text.as_bytes())
    }

    pub(crate) fn from_bytes(path: &'a str, text: &'a [u8]) -> Source<'a> {
        Source {
            path,
            text,
            experimental_decorators: false,
            reads_jsdoc: true,
            keeps_function_directives: false,
        }
    }
}

pub(crate) fn with_workspace(test: impl for<'s> FnOnce(&Workspace<'s>) + Send) {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(scope, move || {
                native::set_stack_size(STACK_SIZE - STACK_RESERVE);
                let session = Session::new();
                let workspace = Workspace {
                    atoms: Interner::new_in(&session),
                    arena: session.arena(),
                };
                test(&workspace);
            })
            .unwrap();
    });
}

pub(crate) fn find_exprs(hir: &File<'_>, test: impl Fn(&ExprKind) -> bool) -> Vec<ExprId> {
    find_ids(&hir.exprs, |expr| test(&expr.kind)).collect()
}

pub(crate) fn find_stmts(hir: &File<'_>, test: impl Fn(&StmtKind) -> bool) -> Vec<StmtId> {
    find_ids(&hir.stmts, |stmt| test(&stmt.kind)).collect()
}

fn find_ids<T, Id: From<u32>>(
    nodes: &[T],
    is_match: impl Fn(&T) -> bool,
) -> impl Iterator<Item = Id> {
    (0u32..)
        .zip(nodes)
        .filter(move |&(_, node)| is_match(node))
        .map(|(index, _)| Id::from(index))
}

pub(crate) fn repository_path(relative: &str) -> PathBuf {
    std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../..")).join(relative)
}

#[allow(clippy::disallowed_methods)]
pub(crate) fn read_file(path: &std::path::Path) -> Option<Vec<u8>> {
    std::fs::read(path).ok()
}

pub(crate) fn for_each_program(
    extensions: &[&str],
    test: impl for<'s> Fn(&Workspace<'s>, &str, &[u8]) + Sync,
) {
    let files = find_programs(extensions);
    assert!(
        files.len() >= MIN_PROGRAM_COUNT,
        "only {} programs have one of the extensions {extensions:?}",
        files.len()
    );
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let threads = std::thread::available_parallelism().map_or(1, |count| count.get());
    for_each_parallel(threads, files.len(), |index| {
        let path = files[index].as_str();
        let Some(text) = read_file(std::path::Path::new(path)) else {
            panic!("{path} cannot be read");
        };
        let workspace = Workspace {
            atoms,
            arena: session.arena(),
        };
        test(&workspace, path, &text);
    });
}

#[allow(clippy::disallowed_methods)]
fn find_programs(extensions: &[&str]) -> Vec<String> {
    let mut files = Vec::new();
    let mut directories = vec![repository_path("test/aot/programs")];
    while let Some(directory) = directories.pop() {
        let entries = std::fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("{}: {error}", directory.display()));
        for entry in entries {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                directories.push(entry.path());
                continue;
            }
            let path = entry.path().into_os_string().into_string().unwrap();
            let has_extension = |extension: &&str| path.ends_with(*extension);
            let is_requested = extensions.iter().any(has_extension);
            let is_declaration = DECLARATION_EXTENSIONS.iter().any(has_extension);
            if is_requested && !is_declaration {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

impl<'s> Workspace<'s> {
    pub(crate) fn atom(&self, text: &str) -> Atom {
        self.atoms.intern(text.as_bytes())
    }

    pub(crate) fn text(&self, atom: Atom) -> &str {
        if atom.is_none() {
            return "<none>";
        }
        std::str::from_utf8(self.atoms.bytes(atom)).unwrap()
    }

    pub(crate) fn parse(&self, source: &Source<'_>) -> File<'s> {
        let options = CompileParseOptions {
            path: source.path.as_bytes(),
            script_kind: None,
            experimental_decorators: source.experimental_decorators,
            every_file_is_a_module: false,
            reads_jsdoc: source.reads_jsdoc,
            keeps_function_directives: source.keeps_function_directives,
        };
        let mut hir = parse_for_compile(self.arena, &options, source.text, &self.atoms);
        self.set_text(&mut hir, source.text);
        hir
    }

    pub(crate) fn parse_for_check(&self, path: &str, text: &[u8]) -> File<'s> {
        let mut hir = summarize(
            self.arena,
            path.as_bytes(),
            None,
            text,
            &self.atoms,
            false,
            false,
        );
        self.set_text(&mut hir, text);
        hir
    }

    #[track_caller]
    pub(crate) fn ident(&self, hir: &File<'s>, name: &str, nth: usize) -> ExprId {
        let atom = self.atom(name);
        let is_match = |expr: &Expr| matches!(expr.kind, ExprKind::Ident(text) if text == atom);
        let found = find_ids(&hir.exprs, is_match).nth(nth);
        self.expect_node(found, "identifier", name, nth)
    }

    #[track_caller]
    pub(crate) fn function(&self, hir: &File<'s>, name: &str) -> FnId {
        let atom = self.atom(name);
        let found = find_ids(&hir.fns, |func| func.name == atom && has_body(func)).next();
        self.expect_node(found, "function with a body", name, 0)
    }

    #[track_caller]
    fn expect_node<Id>(&self, found: Option<Id>, kind: &str, name: &str, nth: usize) -> Id {
        match found {
            Some(id) => id,
            None => panic!("no {kind} `{name}` number {nth}"),
        }
    }

    fn set_text(&self, hir: &mut File<'s>, text: &[u8]) {
        hir.text = Cow::Borrowed(self.arena.alloc_slice_copy(text));
    }
}
