//! Every file of the program, and what its symbols are once the files are put together: which file an import means,
//! which declarations in different files are one symbol, what an alias stands for.

use crate::atom::{Atom, Interner, known, number_to_string};
use crate::bind::{self, Bound, Decl, ScopeId, ScopeKind, SymFlags, Symbol, SymbolId};
use crate::hir::{self, *};
use crate::json::{Expression, Json, PropertyName};
use crate::resolve::{
    Host, JsxEmit, ModuleDetection, ModuleKind, Options, Resolver, ScriptTarget, is_javascript,
    is_relative, join, known_extension, lib_name, parent_dir,
};
use crate::table::{Bases, ByNode, ByNodeKept, RawWord};
use crate::util::{FxHashMap, FxHashSet, List, ListIter};
use crate::verify::{Place, Problem};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct FileId(pub u32);

impl FileId {
    #[inline]
    pub fn idx(self) -> usize {
        self.0 as usize
    }
}

/// A symbol of the program.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Sym {
    pub file: FileId,
    pub id: SymbolId,
}

pub struct Module {
    pub path: String,
    pub hir: hir::File,
    pub bound: Bound,
    /// One of TypeScript's own `lib.*.d.ts`.
    pub is_lib: bool,
    /// Which file each specifier the file mentions means, in each of the ways it is looked for there (`getModeForUsageLocation`).
    pub imports: FxHashMap<(Atom, ResolutionMode), FileId>,
    /// The `/// <reference>`s that lead nowhere: where what they name is written, and what is said of it.
    pub missing_references: Few<(u32, u32)>,
    /// Resolved like Node does, it is an ECMAScript module.
    pub is_esm: bool,
    /// Its name or its package says that it is an ECMAScript module, however modules are resolved. Only asked of packages then.
    pub says_esm: bool,
    /// `GetImpliedNodeFormatForEmit`: what it is emitted as, where its name or its package settles that.
    pub implied_format: ResolutionMode,
    /// `getEmitSyntaxForUsageLocationWorker` of a plain `import` in it: what that is emitted as, which is also how it is resolved.
    pub default_mode: ResolutionMode,
    /// The `package.json` in `PackageJsonDirectory`, if no `PackageJsonType` goes with it. `NONE` otherwise, and unless `module` is
    /// `node16` or `node18`: nothing else asks.
    pub package_json_without_type: Atom,
    /// The specifiers that lead to JavaScript nothing declares the types of, and the way they are looked for when they do.
    pub untyped_imports: Few<(Atom, ResolutionMode)>,
    /// For each of `untyped_imports`: the file it leads to, and `PackageId.Name` of the package that file is in.
    pub untyped_import_files: Few<(Atom, Option<Atom>)>,
    /// `AlternateResult`, of those of `untyped_imports` that have one: the file with the types that is found if the `exports` of the
    /// package are passed over.
    pub untyped_import_alternates: Few<(Atom, ResolutionMode, Atom)>,
    /// Those of `untyped_imports` that lead to a `.jsx` file, which takes `jsx` (`GetResolutionDiagnostic`).
    pub jsx_imports: Few<(Atom, ResolutionMode)>,
    /// Those of `untyped_imports` that resolve to a file inside a package. With `allowJs` such a file is loaded only up to
    /// `maxNodeModuleJsDepth` (`elideOnDepth`).
    pub untyped_package_imports: Few<(Atom, ResolutionMode)>,
    /// `ResolvedUsingTsExtension`: the specifiers that resolve through a TypeScript extension written in the specifier itself, with the
    /// mode they are resolved in.
    pub ts_extension_imports: Few<(Atom, ResolutionMode)>,
    /// `GetResolutionDiagnostic`: the specifiers that resolve to a `.d.css.ts` file or the like without `allowArbitraryExtensions`, with
    /// the mode they are resolved in. They lead to no file (6263).
    pub arbitrary_extension_imports: Few<(Atom, ResolutionMode)>,
    /// For each of `arbitrary_extension_imports`: the file it resolves to.
    pub arbitrary_extension_files: Few<Atom>,
    /// The relative specifiers without an extension, when modules are resolved like Node does, which wants one of `import`; and
    /// whether there is a file that could be meant.
    pub extensionless_imports: Few<(Atom, bool)>,
    /// `ResolvedFileName`, of those of `imports` that resolve to a copy of a file of a package that is in the program under another path.
    pub redirected_imports: Few<(Atom, ResolutionMode, Atom)>,
    /// The files it refers to, in the order it does: `/// <reference>`s, then imports.
    pub edges: Vec<FileId>,
    /// Nothing refers to it, and it adds nothing to what all files see. So `hir` and `bound` are only there while a thread has it at hand:
    /// see `Files::bring_in`.
    pub is_transient: bool,
    /// It adds nothing to what all files see, so it `is_transient` if nothing turns out to refer to it.
    adds_nothing: bool,
    /// `hir` and `bound` were dropped as soon as what it refers to was known, on the guess that nothing refers to it.
    is_dropped: bool,
}

/// A module in the list of all. One that `is_transient` is filled in and emptied again by the one thread that checks it, which is the
/// only one to look at it.
pub struct ModuleCell(std::cell::UnsafeCell<Module>);

// SAFETY: a module is only changed through `&mut Files`, or by the thread that has it at hand while no other looks at it.
unsafe impl Sync for ModuleCell {}

impl std::ops::Deref for ModuleCell {
    type Target = Module;
    #[inline(always)]
    fn deref(&self) -> &Module {
        // SAFETY: see above.
        unsafe { &*self.0.get() }
    }
}

impl std::ops::DerefMut for ModuleCell {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Module {
        self.0.get_mut()
    }
}

/// While it is around, a file is at hand in this thread. Whatever was found out about the file has to be gone before it is.
pub struct AtHand<'a> {
    module: Option<&'a ModuleCell>,
}

impl Drop for AtHand<'_> {
    fn drop(&mut self) {
        let Some(module) = self.module else {
            return;
        };
        // SAFETY: this thread is the only one to look at the module, and is done with it.
        let module = unsafe { &mut *module.0.get() };
        module.hir = stub_of(&mut module.hir, false);
        module.bound = Bound::default();
        crate::local::end();
        crate::types::TypeStore::end_local();
    }
}

/// Reads the files at `paths` and hands what each says to `work`, on all the threads of the host. Where only a few had better read at a time,
/// those few do nothing else, one file after the other, and the rest never wait for a turn to read: a turn that is handed from one
/// thread that sleeps to the next is not made use of meanwhile.
fn read_and_work(
    host: &dyn Host,
    paths: &[&str],
    work: &(dyn Fn(usize, Cow<'static, [u8]>) + Sync),
) {
    let (threads, readers) = (host.threads(), host.readers());
    if readers >= threads || paths.len() < 4 * threads {
        host.parallel(paths.len(), &|i| {
            work(i, host.read(paths[i]).unwrap_or_default());
        });
        return;
    }
    /// What is next to each other is in the same directory.
    const RUN: usize = 16;
    /// What has been read takes memory until it is worked on.
    const AHEAD: usize = 256;
    struct Shared {
        ready: Vec<(usize, Cow<'static, [u8]>)>,
        to_read: usize,
    }
    let shared = Mutex::new(Shared {
        ready: Vec::new(),
        to_read: paths.len(),
    });
    let is_more = std::sync::Condvar::new();
    let (next, arrived) = (AtomicUsize::new(0), AtomicUsize::new(0));
    host.parallel(threads, &|_| {
        if arrived.fetch_add(1, Ordering::Relaxed) < readers {
            loop {
                let from = next.fetch_add(RUN, Ordering::Relaxed);
                if from >= paths.len() {
                    break;
                }
                for i in from..(from + RUN).min(paths.len()) {
                    let text = host.read(paths[i]).unwrap_or_default();
                    let mut shared = shared.lock().unwrap();
                    shared.ready.push((i, text));
                    shared.to_read -= 1;
                    let (is_last, too_far_ahead) =
                        (shared.to_read == 0, shared.ready.len() > AHEAD);
                    let own = if too_far_ahead {
                        shared.ready.pop()
                    } else {
                        None
                    };
                    drop(shared);
                    if is_last {
                        is_more.notify_all();
                    } else {
                        is_more.notify_one();
                    }
                    if let Some((i, text)) = own {
                        work(i, text);
                    }
                }
            }
        }
        loop {
            let mut shared = shared.lock().unwrap();
            let (i, text) = loop {
                if let Some(ready) = shared.ready.pop() {
                    break ready;
                }
                if shared.to_read == 0 {
                    return;
                }
                shared = is_more.wait(shared).unwrap();
            };
            drop(shared);
            work(i, text);
        }
    });
}

/// A guess at whether nothing refers to the file: it exports nothing, or it is called what nothing imports is called. It is only a matter
/// of speed and memory: a file that was wrongly let go of is parsed again, and one that was wrongly held on to is let go of later.
fn looks_like_a_leaf(path: &str, bound: &Bound) -> bool {
    let exports = bound.symbols[bound.file_symbol.idx()].exports;
    if bound.table(exports).is_empty() && bound.export_stars.is_empty() {
        return true;
    }
    let name = path.rsplit_once('/').map_or(path, |(_, name)| name);
    [
        ".test.",
        ".spec.",
        "_test.",
        ".stories.",
        ".bench.",
        ".e2e.",
    ]
    .iter()
    .any(|mark| name.contains(mark))
}

/// What is known of a file whose syntax tree is not there. With `keeps_text`, what it reads stays, for whoever parses it next: opening
/// and reading a file costs about what parsing it does.
fn stub_of(hir: &mut hir::File, keeps_text: bool) -> hir::File {
    hir::File {
        text: if keeps_text {
            std::mem::take(&mut hir.text)
        } else {
            Default::default()
        },
        kind: hir.kind,
        is_js: hir.is_js,
        source_len: hir.source_len,
        has_module_syntax: hir.has_module_syntax,
        is_module_by_decree: hir.is_module_by_decree,
        has_errors: hir.has_errors,
        // Whether it is worth parsing again to hear what the parser has to say.
        has_parse_diagnostics: hir.has_parse_diagnostics || !hir.early_errors.is_empty(),
        ..Default::default()
    }
}

impl Module {
    /// Whether its top-level declarations are its own.
    pub fn is_module(&self) -> bool {
        self.hir.has_module_syntax || self.is_commonjs()
    }

    /// JavaScript that says `require(..)`, `module.exports = ..` or `exports.a = ..`, and neither imports nor exports.
    pub fn is_commonjs(&self) -> bool {
        self.bound.commonjs_indicator.is_some()
    }

    /// The file `spec` means in it, for those who know the name and not where it is written: what it means to a plain `import`, or
    /// else to what does ask for it there. As `Files::module_of_specifier` looks.
    pub fn imported_file(&self, spec: Atom) -> Option<FileId> {
        [
            self.default_mode,
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ]
        .into_iter()
        .find_map(|mode| self.imports.get(&(spec, mode)).copied())
    }

    /// Whether `spec` leads to JavaScript nothing declares the types of, in whatever way it is looked for.
    pub fn is_untyped_import(&self, spec: Atom) -> bool {
        self.untyped_imports.iter().any(|untyped| untyped.0 == spec)
    }

    /// `ResolvedUsingTsExtension` of `spec`, in the mode `imported_file` finds it in.
    pub fn is_resolved_using_ts_extension(&self, spec: Atom) -> bool {
        [
            self.default_mode,
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ]
        .into_iter()
        .find(|&mode| self.imports.contains_key(&(spec, mode)))
        .is_some_and(|mode| self.ts_extension_imports.contains(&(spec, mode)))
    }
}

pub struct Files {
    pub atoms: Interner,
    pub options: Options,
    pub modules: Vec<ModuleCell>,
    pub by_path: FxHashMap<String, FileId>,

    pub globals: FxHashMap<Atom, Sym>,
    ambient_modules: FxHashMap<Atom, Sym>,
    /// `declare module "*.svg"`
    ambient_patterns: Vec<(String, String, Sym)>,
    /// `patternAmbientModuleAugmentations`: by the name written, what `declare module "a.svg"` in a module makes of `declare module "*.svg"`.
    pattern_augmentations: FxHashMap<Atom, Sym>,
    /// From a part to the symbol it is part of.
    merged_into: FxHashMap<Sym, Sym>,
    /// From a symbol to its parts, itself included.
    merged_parts: FxHashMap<Sym, Vec<Sym>>,
    /// `merged_parts`, and among them, in the order they came, those that could not be made one with what was there before. They add
    /// nothing to the symbol. They are errors.
    every_part: FxHashMap<Sym, Vec<Sym>>,
    /// While symbols are put together: `name_means_instead`.
    stand_ins: Vec<(Sym, SymbolId)>,
    merged_exports: FxHashMap<Sym, FxHashMap<Atom, Sym>>,
    /// The tables of `merged_exports` sorted by name, once symbols are put together.
    sorted_exports: FxHashMap<Sym, Box<[(Atom, Sym)]>>,
    /// The pairs `mergeSymbol` refused to make one symbol of, where what a module passes on with `export *`, what a pattern declares or
    /// a name that only stands for something was added to: what was there, and what was to be added.
    pub refused_merges: Vec<(Sym, Sym)>,
    /// The aliases `resolveAlias` found to be circular (2303) while `mergeSymbol` resolved the target of a merge. Their `aliasTarget`
    /// stays `unknownSymbol`, even if the merge breaks the cycle.
    pub circular_at_merge: Vec<Sym>,
    /// Some file says `export type * from`.
    has_type_only_stars: bool,

    /// For each module that was asked about, the names it has only by way of an `export type *`, in order.
    type_only_star_names: ByNodeKept<Sym, Box<[Atom]>>,

    aliases: ByNode<Sym, Option<Sym>>,
    /// What each alias is declared to stand for: one step.
    alias_steps: ByNode<Sym, Option<Sym>>,
    /// Symbols are put together: nothing about them changes any more.
    is_merged: bool,
    memo: Memo,
    /// The order in which declarations of one thing in several files count: it decides the order of overloads.
    order: Vec<FileId>,
    /// What is wrong with what the options name, no file being to blame.
    program_errors: Vec<Problem>,
}

/// What follows from how symbols are put together, each worked out the first time it is asked for. Until they are put together the
/// tables have room for nothing, and so keep nothing.
struct Memo {
    /// From each symbol that is `MERGED` to the symbol it is a part of, which may be itself.
    whole: ByNode<Sym, Option<Sym>>,
    /// `symbol_flags` of an alias, with `FLAGS_KNOWN` set.
    symbol_flags: ByNode<Sym, RawWord>,
    /// The declarations of a symbol that has several.
    decls: ByNodeKept<Sym, Box<[(FileId, Decl)]>>,
    /// `export_stars_of`
    export_stars: ByNodeKept<Sym, Box<[(Option<Sym>, bool)]>>,
    /// `all_module_exports`
    all_exports: ByNodeKept<Sym, Box<[(Atom, Sym)]>>,
    has_known_exports: ByNode<Sym, bool>,
}

/// No flag of a symbol.
const FLAGS_KNOWN: u32 = 1 << 31;

impl Memo {
    fn new(symbols: &Bases) -> Memo {
        Memo {
            whole: ByNode::new(symbols),
            symbol_flags: ByNode::new(symbols),
            decls: ByNodeKept::new(symbols),
            export_stars: ByNodeKept::new(symbols),
            all_exports: ByNodeKept::new(symbols),
            has_known_exports: ByNode::new(symbols),
        }
    }
}

/// `Files::each_export`. One of the two lists is empty.
struct Exports<'a> {
    files: &'a Files,
    file: FileId,
    /// As the binder has them.
    own: std::slice::Iter<'a, (Atom, SymbolId)>,
    merged: ListIter<'a, (Atom, Sym)>,
}

impl Iterator for Exports<'_> {
    type Item = (Atom, Sym);
    #[inline]
    fn next(&mut self) -> Option<(Atom, Sym)> {
        match self.own.next() {
            Some(&(name, id)) => Some((name, self.files.sym(self.file, id))),
            None => self.merged.next(),
        }
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let left = self.own.len() + self.merged.len();
        (left, Some(left))
    }
}

impl ExactSizeIterator for Exports<'_> {}

struct Loaded {
    module: Module,
    /// (specifier, the way it is looked for, what it resolved to, whether that is brought into the program for it)
    imports: Vec<(Atom, ResolutionMode, String, bool)>,
    /// (path, is a lib, `increaseDepth`)
    references: Vec<(String, bool, bool)>,
}

/// What a thread is in the middle of finding out about aliases (`pushTypeResolution`).
struct Resolving {
    /// The aliases it is looking for the ends of.
    ends: Vec<Sym>,
    /// Those it is looking for the targets of.
    steps: Vec<Sym>,
    /// How often it has come back to one of either, and gone no further.
    circles: u32,
}

thread_local! {
    static RESOLVING: std::cell::RefCell<Resolving> = const { std::cell::RefCell::new(Resolving { ends: Vec::new(), steps: Vec::new(), circles: 0 }) };
}

/// How a module is asked for, to `canHaveSyntheticDefault`: in a mode, or the way a plain `import` in a file is emitted.
pub trait Usage: Copy {
    fn mode(self, files: &Files) -> ResolutionMode;
}

impl Usage for ResolutionMode {
    fn mode(self, _: &Files) -> ResolutionMode {
        self
    }
}

impl Usage for FileId {
    fn mode(self, files: &Files) -> ResolutionMode {
        files.module(self).default_mode
    }
}

fn json_to_hir(text: &[u8], atoms: &Interner) -> hir::File {
    fn value(f: &mut hir::File, json: &Json, atoms: &Interner) -> ExprId {
        let kind = match json {
            Json::Null => ExprKind::Null,
            Json::Bool(true) => ExprKind::True,
            Json::Bool(false) => ExprKind::False,
            Json::Number(n) => ExprKind::Number(f.number(*n)),
            Json::String(s) => ExprKind::String(atoms.intern_str(s)),
            Json::Array(items) => {
                let items: Vec<ExprId> = items.iter().map(|i| value(f, i, atoms)).collect();
                ExprKind::Array(f.list(&items))
            }
            Json::Object(entries) => {
                let props: Vec<Prop> = entries
                    .iter()
                    .map(|(k, v)| Prop {
                        kind: PropKind::Init,
                        key: PropKey::Name(atoms.intern_str(k)),
                        value: value(f, v, atoms),
                        pos: 0,
                    })
                    .collect();
                ExprKind::Object(f.add_props(&props))
            }
        };
        f.expr(kind, 0)
    }
    // The same for a file with syntax errors, as TypeScript's parser recovers from them.
    fn expression(f: &mut hir::File, e: &Expression, atoms: &Interner) -> ExprId {
        let kind = match e {
            Expression::Null => ExprKind::Null,
            Expression::Bool(true) => ExprKind::True,
            Expression::Bool(false) => ExprKind::False,
            Expression::Number(n) => ExprKind::Number(f.number(*n)),
            Expression::String(s) => ExprKind::String(atoms.intern_str(s)),
            Expression::Identifier(name) => ExprKind::Ident(atoms.intern_str(name)),
            Expression::Missing => ExprKind::Missing,
            Expression::Array(items) => {
                let items: Vec<ExprId> = items.iter().map(|i| expression(f, i, atoms)).collect();
                ExprKind::Array(f.list(&items))
            }
            Expression::Object(properties) => {
                let props: Vec<Prop> = properties
                    .iter()
                    .map(|p| {
                        let key = match &p.name {
                            PropertyName::Name(name)
                            | PropertyName::Computed(Expression::String(name)) => {
                                PropKey::Name(atoms.intern_str(name))
                            }
                            PropertyName::Computed(Expression::Number(n))
                                if !n.is_sign_negative() =>
                            {
                                PropKey::Name(atoms.intern_str(&number_to_string(*n)))
                            }
                            PropertyName::Computed(name) => {
                                PropKey::Computed(expression(f, name, atoms))
                            }
                        };
                        let (kind, value) = match (&p.initializer, key) {
                            (Some(initializer), _) => {
                                (PropKind::Init, expression(f, initializer, atoms))
                            }
                            (None, PropKey::Name(name)) => {
                                (PropKind::Shorthand, f.expr(ExprKind::Ident(name), 0))
                            }
                            (None, _) => (PropKind::Init, f.expr(ExprKind::Missing, 0)),
                        };
                        Prop {
                            kind,
                            key,
                            value,
                            pos: 0,
                        }
                    })
                    .collect();
                ExprKind::Object(f.add_props(&props))
            }
        };
        f.expr(kind, 0)
    }
    let mut f = hir::File {
        kind: FileKind::Json,
        has_module_syntax: true,
        ..Default::default()
    };
    // `bindSourceFileIfExternalModule`: a JSON file is `export =` what it says, and `{}` if it says nothing.
    let json = if Json::is_blank(text) {
        Some(Json::Object(Vec::new()))
    } else {
        Json::parse(text)
    };
    match json {
        Some(json) => {
            let e = value(&mut f, &json, atoms);
            let stmt = f.stmt(StmtKind::ExportAssign(e), 0);
            f.body = f.list(&[stmt]);
        }
        None => match Expression::parse(text) {
            Some(recovered) => {
                let e = expression(&mut f, &recovered, atoms);
                let stmt = f.stmt(StmtKind::ExportAssign(e), 0);
                f.body = f.list(&[stmt]);
                f.has_parse_diagnostics = true;
            }
            None => f.has_errors = true,
        },
    }
    f
}

/// `GetJSXRuntimeImport` of `GetJSXImplicitImportBase`.
pub(crate) fn jsx_runtime_of(options: &Options, hir: &File, atoms: &Interner) -> Option<String> {
    if hir.jsx_pragmas.classic == Some(true) {
        return None;
    }
    let runtime = if options.jsx == JsxEmit::ReactJsxDev {
        "jsx-dev-runtime"
    } else {
        "jsx-runtime"
    };
    if hir.jsx_pragmas.import_source.is_some() {
        return Some(format!(
            "{}/{runtime}",
            atoms.text(hir.jsx_pragmas.import_source)
        ));
    }
    if !options.jsx_runtime.is_empty() {
        return Some(options.jsx_runtime.clone());
    }
    (hir.jsx_pragmas.classic == Some(false))
        .then(|| format!("{}/{runtime}", options.jsx_import_source))
}

/// `pathForLibFile`: where `lib.<lib>.d.ts` is read from, and whether that is TypeScript's own file.
fn lib_path(resolver: &Resolver, options: &Options, lib: &str) -> (String, bool) {
    if options.lib_replacement {
        // `getLibraryNameFromLibFileName`: `dom.iterable` is `@typescript/lib-dom/iterable`, `es2015.symbol.wellknown` is
        // `@typescript/lib-es2015/symbol-wellknown`.
        let mut name = String::from("@typescript/lib-");
        for (i, part) in lib.split('.').enumerate() {
            match i {
                0 => {}
                1 => name.push('/'),
                _ => name.push('-'),
            }
            name.push_str(part);
        }
        // `getInferredLibraryNameResolveFrom`
        let from = format!(
            "{}/__lib_node_modules_lookup_lib.{lib}.d.ts__.ts",
            options.base_dir
        );
        // `resolveLibrary`: always the way `require` would.
        if let Some(found) = resolver.resolve_as(&name, &from, ResolutionMode::Require) {
            return (found, false);
        }
    }
    (format!("{}/lib.{lib}.d.ts", options.lib_dir), true)
}

/// `HasExtension`
fn has_extension(path: &str) -> bool {
    path[path.rfind('/').map_or(0, |i| i + 1)..].contains('.')
}

/// The first test of `getSourceFileFromReference`: the error code for a file name whose extension is not supported
/// (`isSupportedExtension`). JavaScript needs `allowJs`, JSON needs `resolveJsonModule`. `None` for a name without an extension.
fn unsupported_extension_error(options: &Options, path: &str) -> Option<u32> {
    let is_supported = [".ts", ".tsx", ".mts", ".cts"]
        .iter()
        .any(|e| path.ends_with(e))
        || options.allow_js && is_javascript(path)
        || options.resolve_json_module && path.ends_with(".json");
    if !has_extension(path) || is_supported {
        return None;
    }
    Some(if is_javascript(path) { 6504 } else { 6054 })
}

/// What `unsupported_extension_error` found of the file at `path`, in full.
fn unsupported_extension_problem(options: &Options, code: u32, path: &str) -> Problem {
    if code == 6504 {
        return Problem::new(code, &[path], Place::Nowhere);
    }
    // `GetSupportedExtensions`, flattened.
    let extensions: Vec<&str> = if options.allow_js {
        vec![
            ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".cts", ".d.cts", ".cjs", ".mts", ".d.mts",
            ".mjs",
        ]
    } else {
        vec![".ts", ".tsx", ".d.ts", ".cts", ".d.cts", ".mts", ".d.mts"]
    };
    let quoted: Vec<String> = extensions.iter().map(|e| format!("'{e}'")).collect();
    Problem::new(code, &[path, &quoted.join(", ")], Place::Nowhere)
}

/// `resolveTripleslashPathReference`: where the `/// <reference path>` that says `written` in the file at `from` points to.
fn referenced_path(written: &str, from: &str) -> String {
    let written = written.replace('\\', "/");
    match written.as_bytes() {
        // `c:/a` is `/c:/a` here.
        [drive, b':', b'/', ..] if drive.is_ascii_alphabetic() => join("/", &written),
        _ => join(parent_dir(from), &written),
    }
}

/// `getSourceFileFromReference`: the file a `/// <reference path>` in `from` means, `name` being where it points to; or else what is
/// said of it.
fn referenced_file(
    host: &dyn Host,
    options: &Options,
    name: &str,
    from: &str,
) -> Result<String, u32> {
    // With an extension, it is that file or none.
    if has_extension(name) {
        if let Some(code) = unsupported_extension_error(options, name) {
            return Err(code);
        }
        if !host.is_file(name) {
            return Err(6053);
        }
        if name == from {
            return Err(1006);
        }
        return Ok(name.to_owned());
    }
    // `supportedExtensions[0]`
    let extensions: &[&str] = if options.allow_js {
        &[".ts", ".tsx", ".d.ts", ".js", ".jsx"]
    } else {
        &[".ts", ".tsx", ".d.ts"]
    };
    extensions
        .iter()
        .map(|e| format!("{name}{e}"))
        .find(|c| host.is_file(c))
        .ok_or(6231)
}

/// `GetAutomaticTypeDirectiveNames`: what `compilerOptions.types` names. A `*` in it stands for every package under the type roots.
fn automatic_type_directives(host: &dyn Host, options: &Options) -> Vec<String> {
    // Since TypeScript 6.0 nothing under `node_modules/@types` is included unless something asks for it.
    let Some(types) = &options.types else {
        return Vec::new();
    };
    if !types.iter().any(|t| t == "*") {
        return types.clone();
    }
    let mut packages = Vec::new();
    for root in options.effective_type_roots() {
        let mut names = host.list_dir(&root);
        names.sort_unstable();
        for name in names {
            let dir = format!("{root}/{name}");
            if name.starts_with('.') || !host.is_dir(&dir) {
                continue;
            }
            // `"typings": null` is how a package says that it is not needed.
            let package = host
                .read(&format!("{dir}/package.json"))
                .and_then(|text| Json::parse(&text));
            if package.is_none_or(|p| p.get("typings") != Some(&Json::Null)) {
                packages.push(name);
            }
        }
    }
    let mut all: Vec<String> = Vec::new();
    for name in types {
        let names = if name == "*" {
            packages.as_slice()
        } else {
            std::slice::from_ref(name)
        };
        for name in names {
            if !all.contains(name) {
                all.push(name.clone());
            }
        }
    }
    all
}

/// `GetPathComponents` of an absolute path: the root, then the names. The root is empty, or a drive: `/c:/a` is `c:/a` to TypeScript.
fn components_of_path(path: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let starts_with_drive = parts.first().is_some_and(
        |first| matches!(first.as_bytes(), [letter, b':'] if letter.is_ascii_alphabetic()),
    );
    if !starts_with_drive {
        parts.insert(0, "");
    }
    parts
}

/// `GetCanonicalFileName` of both.
fn is_same_name(a: &str, b: &str, is_case_sensitive: bool) -> bool {
    if is_case_sensitive {
        a == b
    } else {
        a.to_lowercase() == b.to_lowercase()
    }
}

/// `ContainsPath`
fn is_path_under(parent: &str, child: &str, is_case_sensitive: bool) -> bool {
    let (parent, child) = (components_of_path(parent), components_of_path(child));
    parent.len() <= child.len()
        && parent
            .iter()
            .zip(&child)
            .all(|(a, b)| is_same_name(a, b, is_case_sensitive))
}

/// `computeCommonSourceDirectoryOfFilenames`. `None`: the files have nothing in common, not even the drive.
fn common_directory_of(files: &[&str], is_case_sensitive: bool) -> Option<String> {
    fn directory(file: &str) -> Vec<&str> {
        let mut parts = components_of_path(file);
        parts.pop();
        parts
    }
    let Some((first, rest)) = files.split_first() else {
        return Some("/".to_owned());
    };
    let mut common = directory(first);
    for file in rest {
        let parts = directory(file);
        let shared = common
            .iter()
            .zip(&parts)
            .take_while(|(a, b)| is_same_name(a, b, is_case_sensitive))
            .count();
        if shared == 0 {
            return None;
        }
        common.truncate(shared);
    }
    Some(join("/", &common.join("/")))
}

/// The parts of `verifyCompilerOptions` that go by where output is written. 6059 (`checkSourceFilesBelongToPath`) for a root file that
/// is not under `rootDir`, 5009 and 5011 for what the sources have in common, and `verifyEmitFilePath`: 5055 for an output file that is
/// an input file, 5056 for one that two input files are written to.
fn output_path_errors(
    host: &dyn Host,
    options: &Options,
    modules: &[ModuleCell],
    by_path: &FxHashMap<String, FileId>,
    roots: &[String],
) -> Vec<Problem> {
    let mut errors = Vec::new();
    let is_case_sensitive = host.is_case_sensitive();
    let declaration_dir = if options.writes_declarations {
        options.declaration_dir.as_str()
    } else {
        ""
    };
    // `sourceFileMayBeEmitted`: without `outDir` a JSON file is not.
    let sources: Vec<&Module> = modules
        .iter()
        .map(|module| &**module)
        .filter(|module| {
            !module.is_lib
                && module.hir.kind != FileKind::Declaration
                && !module.path.contains("/node_modules/")
                && (module.hir.kind != FileKind::Json || !options.out_dir.is_empty())
        })
        .collect();
    let paths: Vec<&str> = sources.iter().map(|module| module.path.as_str()).collect();
    // `CommonSourceDirectory`, where anything goes by it. `None`: there is none.
    let mut common = None;
    if !options.out_dir.is_empty()
        || !options.root_dir.is_empty()
        || options.says_source_or_map_root
        || !declaration_dir.is_empty()
    {
        let said = if !options.root_dir.is_empty() {
            options.root_dir.as_str()
        } else if !options.config_path.is_empty() {
            parent_dir(&options.config_path)
        } else {
            ""
        };
        if said.is_empty() {
            common = common_directory_of(&paths, is_case_sensitive);
        } else {
            // What an import brings in may belong to a project that is referred to, which is not kept track of.
            let roots: FxHashSet<&str> = roots.iter().map(String::as_str).collect();
            for &path in &paths {
                if roots.contains(path) && !is_path_under(said, path, is_case_sensitive) {
                    errors.push(
                        Problem::new(6059, &[path, said], Place::Nowhere)
                            .with(1, 1430, &[])
                            .with(2, 1427, &[]),
                    );
                }
            }
            common = Some(said.to_owned());
        }
        if common.is_none() && !options.out_dir.is_empty() {
            errors.push(Problem::new(5009, &[], Place::Key("outDir", "")));
        }
    }
    if options.no_emit {
        return errors;
    }
    // Before TypeScript 6 it was what the sources have in common, configuration file or not.
    if !options.composite
        && options.root_dir.is_empty()
        && !options.config_path.is_empty()
        && (!options.out_dir.is_empty() || !declaration_dir.is_empty())
        && !paths.is_empty()
        && let Some(computed) = common_directory_of(&paths, is_case_sensitive)
        && !is_same_name(
            &computed,
            parent_dir(&options.config_path),
            is_case_sensitive,
        )
    {
        let (one, other) = if options.out_dir.is_empty() {
            ("declarationDir", "")
        } else {
            ("outDir", "declarationDir")
        };
        let config_name =
            &options.config_path[options.config_path.rfind('/').map_or(0, |i| i + 1)..];
        let relative = crate::verify::relative_from_file(&options.config_path, &computed);
        errors.push(
            Problem::new(5011, &[config_name, &relative], Place::Key(one, other)).with(
                1,
                5111,
                &[],
            ),
        );
    }
    if options.suppress_output_path_check {
        return errors;
    }
    let mut seen: FxHashSet<String> = FxHashSet::default();
    let mut verify = |output: String| {
        if by_path.contains_key(&output) {
            let problem = Problem::new(5055, &[&output], Place::Nowhere);
            errors.push(if options.has_config_file {
                problem
            } else {
                problem.with(1, 5068, &[])
            });
        }
        let key = if is_case_sensitive {
            output.clone()
        } else {
            output.to_lowercase()
        };
        if seen.contains(&key) {
            errors.push(Problem::new(5056, &[&output], Place::Nowhere));
        } else {
            seen.insert(key);
        }
    };
    // `GetSourceFilePathInNewDir`: in `dir`, where it is in what the sources have in common. What is not in that stays where it is.
    let moved_to = |dir: &str, path: &str| match &common {
        _ if dir.is_empty() => path.to_owned(),
        Some(common) if is_path_under(common, path, is_case_sensitive) => join(
            dir,
            path.get(common.len()..)
                .unwrap_or("")
                .trim_start_matches('/'),
        ),
        _ => path.to_owned(),
    };
    // `RemoveFileExtension`
    let without_extension =
        |path: String| path[..path.len() - known_extension(&path).len()].to_owned();
    for module in sources {
        let path = module.path.as_str();
        let is_json = module.hir.kind == FileKind::Json;
        let is_one_of = |extensions: [&str; 2]| extensions.iter().any(|e| path.ends_with(e));
        if !options.emit_declaration_only {
            // `GetOutputExtension`
            let extension = if is_json {
                ".json"
            } else if options.jsx == JsxEmit::Preserve && is_one_of([".jsx", ".tsx"]) {
                ".jsx"
            } else if is_one_of([".mts", ".mjs"]) {
                ".mjs"
            } else if is_one_of([".cts", ".cjs"]) {
                ".cjs"
            } else {
                ".js"
            };
            let stem = without_extension(moved_to(&options.out_dir, path));
            let output = format!("{stem}{extension}");
            // A JSON file that would be written where it is read from is not written.
            if !is_json || output != path {
                let map = format!("{output}.map");
                verify(output);
                if options.writes_source_maps && !is_json {
                    verify(map);
                }
            }
        }
        // `GetDeclarationEmitOutputFilePath`
        let declarations_in = if declaration_dir.is_empty() {
            options.out_dir.as_str()
        } else {
            declaration_dir
        };
        if options.writes_declarations && !is_json {
            // `GetDeclarationEmitExtensionForPath`
            let extension = if is_one_of([".mjs", ".mts"]) {
                ".d.mts"
            } else if is_one_of([".cjs", ".cts"]) {
                ".d.cts"
            } else {
                ".d.ts"
            };
            let stem = without_extension(moved_to(declarations_in, path));
            let output = format!("{stem}{extension}");
            let map = format!("{output}.map");
            verify(output);
            if options.writes_declaration_maps {
                verify(map);
            }
        }
    }
    errors
}

/// `GetSymbolNameForPrivateIdentifier`: `#x` is a name of the class that declares it and of no other. From here on it is spelled
/// `#x@<hash of the path>.<class>`, where it is declared and wherever it is meant. An `#x` that no class around declares stays `#x`, which names
/// nothing.
fn rename_private_names(hir: &mut hir::File, bound: &Bound, atoms: &Interner, path: &str) {
    let file = crate::util::spread_hash(path);
    let renamed = |class: u32, name: Atom| {
        atoms.intern_str(&format!("{}@{:x}.{}", atoms.text(name), file, class))
    };
    for class in 0..hir.classes.len() {
        for member in hir.classes[class].members.iter() {
            if let PropKey::Private(name) = hir.members[member.idx()].key {
                hir.members[member.idx()].key = PropKey::Private(renamed(class as u32, name));
            }
        }
    }
    for (&e, &class) in &bound.private_class {
        if let ExprKind::Dot { name, .. } | ExprKind::String(name) = &mut hir.exprs[e.idx()].kind {
            *name = renamed(class.0, *name);
        }
    }
}

/// `collectModuleReferences`: whether the `declare global` that `symbol` is adds to the global scope. It does at the top of a module,
/// and right in a `declare module "m"` at the top of a script.
fn is_global_augmentation(module: &Module, symbol: SymbolId) -> bool {
    let (hir, bound) = (&module.hir, &module.bound);
    let is_it = |s: StmtId| matches!(hir[s].kind, StmtKind::Module(m) if bound.module_symbol[m.idx()] == symbol);
    if module.is_module() {
        return hir.ids(hir.body).any(is_it);
    }
    hir.ids(hir.body).any(|s| {
        let StmtKind::Module(m) = hir[s].kind else {
            return false;
        };
        !matches!(hir[m].name, ModuleName::Ident(_))
            && (hir[m].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration)
            && hir.ids(hir[m].body).any(is_it)
    })
}

/// `SymbolFlagsModuleMember`: what the body of a module or namespace sees of what it exports.
const MODULE_MEMBER: SymFlags = SymFlags::VARIABLE
    .union(SymFlags::FUNCTION)
    .union(SymFlags::CLASS)
    .union(SymFlags::INTERFACE)
    .union(SymFlags::ENUM)
    .union(SymFlags::MODULE)
    .union(SymFlags::TYPE_ALIAS)
    .union(SymFlags::ALIAS);

/// `getExcludedSymbolFlags`: what a symbol with `flags` cannot be one with.
fn excluded_flags(flags: SymFlags) -> SymFlags {
    let value = SymFlags::VALUE;
    let both = SymFlags::VALUE | SymFlags::TYPE;
    let mut out = SymFlags::empty();
    if flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE) {
        out |= value;
    }
    if flags.contains(SymFlags::FUNCTION_SCOPED_VARIABLE) {
        out |= value.difference(SymFlags::FUNCTION_SCOPED_VARIABLE);
    }
    if flags.contains(SymFlags::EXPORT_VALUE) {
        out |= value.difference(SymFlags::EXPORT_VALUE);
    }
    if flags.contains(SymFlags::ENUM_MEMBER) {
        out |= both;
    }
    if flags.contains(SymFlags::FUNCTION) {
        out |= value.difference(SymFlags::FUNCTION | SymFlags::VALUE_MODULE | SymFlags::CLASS);
    }
    if flags.contains(SymFlags::CLASS) {
        out |= both.difference(SymFlags::VALUE_MODULE | SymFlags::INTERFACE | SymFlags::FUNCTION);
    }
    if flags.contains(SymFlags::INTERFACE) {
        out |= SymFlags::TYPE.difference(SymFlags::INTERFACE | SymFlags::CLASS);
    }
    if flags.contains(SymFlags::ENUM) {
        out |= both.difference(SymFlags::ENUM | SymFlags::VALUE_MODULE);
    }
    if flags.contains(SymFlags::VALUE_MODULE) {
        out |= value.difference(
            SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM | SymFlags::VALUE_MODULE,
        );
    }
    if flags.contains(SymFlags::TYPE_PARAMETER) {
        out |= SymFlags::TYPE.difference(SymFlags::TYPE_PARAMETER);
    }
    if flags.contains(SymFlags::TYPE_ALIAS) {
        out |= SymFlags::TYPE;
    }
    if flags.contains(SymFlags::ALIAS) {
        out |= SymFlags::ALIAS;
    }
    out
}

impl Files {
    /// Reads `roots` and everything that can be reached from them.
    pub fn load(host: &dyn Host, options: Options, roots: &[String]) -> Files {
        let atoms = Interner::new();
        let resolver = Resolver::new(host, &options);
        let mut by_path: FxHashMap<String, FileId> = FxHashMap::default();
        let mut by_package_id: FxHashMap<String, FileId> = FxHashMap::default();
        let mut modules: Vec<Option<Module>> = Vec::new();
        // `parseTaskData.lowestDepth`, by `FileId`: the fewest steps into packages (`increaseDepth`) on a path from a root file.
        let mut depths: Vec<u32> = Vec::new();
        let mut frontier: Vec<(FileId, String, bool)> = Vec::new();
        let mut add = |path: String,
                       is_lib: bool,
                       depth: u32,
                       modules: &mut Vec<Option<Module>>,
                       depths: &mut Vec<u32>,
                       frontier: &mut Vec<(FileId, String, bool)>|
         -> FileId {
            if let Some(&id) = by_path.get(&path) {
                depths[id.idx()] = depths[id.idx()].min(depth);
                return id;
            }
            if !options.keeps_duplicate_packages
                && let Some(package_id) = resolver.package_id(&path)
            {
                match by_package_id.get(&package_id) {
                    Some(&id) => {
                        by_path.insert(path, id);
                        depths[id.idx()] = depths[id.idx()].min(depth);
                        return id;
                    }
                    None => {
                        by_package_id.insert(package_id, FileId(modules.len() as u32));
                    }
                }
            }
            let id = FileId(modules.len() as u32);
            modules.push(None);
            depths.push(depth);
            by_path.insert(path.clone(), id);
            frontier.push((id, path, is_lib));
            id
        };

        let mut starts: Vec<FileId> = Vec::new();
        for lib in &options.libs {
            let (path, is_lib) = lib_path(&resolver, &options, lib);
            starts.push(add(
                path,
                is_lib,
                0,
                &mut modules,
                &mut depths,
                &mut frontier,
            ));
        }
        let mut program_errors = Vec::new();
        for root in roots {
            // `addRootFileTask`, `getSourceFileFromReference`: a name without an extension stands for the file that has one.
            let with_extension = if has_extension(root) {
                None
            } else {
                referenced_file(host, &options, root, "").ok()
            };
            let root = with_extension.as_ref().unwrap_or(root);
            // `parseTask.load`: a root file with an unsupported extension is reported and not loaded.
            match unsupported_extension_error(&options, root) {
                Some(code) => program_errors.push(
                    unsupported_extension_problem(&options, code, root)
                        .with(1, 1430, &[])
                        .with(2, 1427, &[]),
                ),
                None => starts.push(add(
                    root.clone(),
                    false,
                    0,
                    &mut modules,
                    &mut depths,
                    &mut frontier,
                )),
            }
        }
        for name in &automatic_type_directives(host, &options) {
            match resolver.resolve_type_reference(
                name,
                &options.base_dir,
                ResolutionMode::None,
                true,
            ) {
                Some(path) => {
                    let depth = u32::from(path.contains("/node_modules/"));
                    starts.push(add(
                        path,
                        false,
                        depth,
                        &mut modules,
                        &mut depths,
                        &mut frontier,
                    ));
                }
                // `*` is whatever there is.
                None if name == "*" => {}
                None => program_errors.push(
                    Problem::new(2688, &[name], Place::Nowhere)
                        .with(1, 1430, &[])
                        .with(
                            2,
                            if options.types.is_some() { 1417 } else { 1420 },
                            &[name],
                        ),
                ),
            }
        }

        // What is looked for without being brought in: it is found if it is in the program for another reason.
        let mut only_found: Vec<(FileId, Atom, ResolutionMode, String)> = Vec::new();
        // Only what nothing has been seen to refer to: the files the program starts from.
        let mut may_drop = options.drops_what_nothing_refers_to;
        let mut is_first = true;
        let mut ahead: FxHashMap<String, Box<Loaded>> = FxHashMap::default();
        while !frontier.is_empty() {
            let batch = std::mem::take(&mut frontier);
            if is_first {
                is_first = false;
                let seeds = batch
                    .iter()
                    .map(|(_, path, is_lib)| (path.clone(), *is_lib, may_drop))
                    .collect();
                ahead = Self::load_ahead(host, &resolver, &options, &atoms, seeds);
            }
            let results: Vec<Mutex<Option<Box<Loaded>>>> = batch
                .iter()
                .map(|(_, path, is_lib)| {
                    Mutex::new(
                        ahead
                            .remove(path)
                            .filter(|loaded| loaded.module.is_lib == *is_lib),
                    )
                })
                .collect();
            // What could not be told ahead to be part of the program.
            let missing: Vec<usize> = (0..batch.len())
                .filter(|&i| results[i].lock().unwrap().is_none())
                .collect();
            let paths: Vec<&str> = missing.iter().map(|&i| &batch[i].1[..]).collect();
            read_and_work(host, &paths, &|at, text| {
                let (_, path, is_lib) = &batch[missing[at]];
                *results[missing[at]].lock().unwrap() = Some(Box::new(Self::load_one(
                    host, &resolver, &options, &atoms, path, *is_lib, may_drop, text,
                )));
            });
            may_drop = false;
            for ((id, _, _), result) in batch.iter().zip(results) {
                let mut loaded = *result.into_inner().unwrap().unwrap();
                // `filesParser.start`: the sub tasks of a file start once, at the lowest depth the file has been reached at by then.
                let depth = depths[id.idx()];
                for (path, is_lib, increases_depth) in loaded.references {
                    let target = add(
                        path,
                        is_lib,
                        depth + u32::from(increases_depth),
                        &mut modules,
                        &mut depths,
                        &mut frontier,
                    );
                    loaded.module.edges.push(target);
                }
                for (spec, mode, path, brings_in) in loaded.imports {
                    // `increaseDepth`: `IsExternalLibraryImport`, which also holds for a relative specifier.
                    let is_in_package = path.contains("/node_modules/");
                    let depth = depth + u32::from(is_in_package);
                    // `elideOnDepth`: JavaScript deeper inside packages than `maxNodeModuleJsDepth` is not loaded.
                    let is_elided = is_in_package
                        && is_javascript(&path)
                        && depth > options.max_node_module_js_depth;
                    // `shouldAddFile`: with `noResolve` nothing does.
                    if !brings_in || is_elided || options.no_resolve {
                        only_found.push((*id, spec, mode, path));
                        continue;
                    }
                    let target = add(path, false, depth, &mut modules, &mut depths, &mut frontier);
                    loaded.module.imports.insert((spec, mode), target);
                    loaded.module.edges.push(target);
                }
                modules[id.idx()] = Some(loaded.module);
            }
        }
        program_errors.extend(resolver.resolution_problems());
        for (id, spec, mode, path) in only_found {
            if let Some(&target) = by_path.get(&path)
                && let Some(module) = &mut modules[id.idx()]
            {
                module.imports.insert((spec, mode), target);
            }
        }

        // `redirectFilesByPath`: the paths that stand for a file that is kept under another.
        let kept: FxHashMap<FileId, String> = by_path
            .iter()
            .filter_map(|(path, &id)| {
                let kept = &modules[id.idx()].as_ref()?.path;
                (kept != path).then(|| (id, kept.clone()))
            })
            .collect();
        if !kept.is_empty() {
            for module in modules.iter_mut().flatten() {
                let mut redirected = Vec::new();
                for (&(spec, mode), target) in &module.imports {
                    if let Some(kept) = kept.get(target)
                        && let Some(found) =
                            resolver.resolve_module(&atoms.text(spec), &module.path, mode)
                        && found != *kept
                    {
                        redirected.push((spec, mode, atoms.intern(found.as_bytes())));
                    }
                }
                module.redirected_imports = redirected.into();
            }
        }
        drop(resolver);
        let mut modules: Vec<ModuleCell> = modules
            .into_iter()
            .map(|module| ModuleCell(module.unwrap().into()))
            .collect();
        if options.drops_what_nothing_refers_to {
            let mut is_referred_to = vec![false; modules.len()];
            for module in &modules {
                for &target in module.edges.iter().chain(module.imports.values()) {
                    is_referred_to[target.idx()] = true;
                }
            }
            // The guess was wrong: something refers to it.
            let back: Vec<usize> = (0..modules.len())
                .filter(|&i| modules[i].is_dropped && is_referred_to[i])
                .collect();
            let parsed: Vec<Mutex<Option<(hir::File, Bound)>>> =
                back.iter().map(|_| Mutex::new(None)).collect();
            let texts: Vec<Mutex<Cow<'static, [u8]>>> = back
                .iter()
                .map(|&i| Mutex::new(std::mem::take(&mut modules[i].hir.text)))
                .collect();
            host.parallel(back.len(), &|at| {
                let text = std::mem::take(&mut *texts[at].lock().unwrap());
                let module = &modules[back[at]];
                let (mut hir, mut bound) = Self::parse_and_bind(
                    host,
                    &options,
                    &atoms,
                    &module.path,
                    module.is_lib,
                    module.says_esm,
                    text,
                );
                hir.fit();
                bound.fit();
                *parsed[at].lock().unwrap() = Some((hir, bound));
            });
            for (&i, parsed) in back.iter().zip(parsed) {
                let (hir, bound) = parsed.into_inner().unwrap().unwrap();
                let module = &mut *modules[i];
                (module.hir, module.bound, module.is_dropped) = (hir, bound, false);
            }
            for (i, module) in modules.iter_mut().enumerate() {
                module.is_transient = module.adds_nothing && !is_referred_to[i];
                if module.is_transient && !module.is_dropped {
                    module.hir = stub_of(&mut module.hir, true);
                    module.bound = Bound::default();
                }
            }
        }
        program_errors.extend(output_path_errors(
            host, &options, &modules, &by_path, roots,
        ));
        let has_type_only_stars = modules
            .iter()
            .any(|m| m.bound.export_star_type_only.contains(&true));
        let symbols = Bases::new(modules.iter().map(|m| m.bound.symbols.len()));
        let memo = Memo::new(&Bases::new(modules.iter().map(|_| 0)));
        let mut files = Files {
            atoms,
            options,
            modules,
            by_path,
            globals: FxHashMap::default(),
            ambient_modules: FxHashMap::default(),
            ambient_patterns: Vec::new(),
            pattern_augmentations: FxHashMap::default(),
            merged_into: FxHashMap::default(),
            merged_parts: FxHashMap::default(),
            every_part: FxHashMap::default(),
            stand_ins: Vec::new(),
            merged_exports: FxHashMap::default(),
            sorted_exports: FxHashMap::default(),
            refused_merges: Vec::new(),
            circular_at_merge: Vec::new(),
            has_type_only_stars,
            type_only_star_names: ByNodeKept::new(&symbols),
            aliases: ByNode::new(&symbols),
            alias_steps: ByNode::new(&symbols),
            is_merged: false,
            memo,
            order: Vec::new(),
            program_errors,
        };
        files.order = files.declaration_order(&starts);
        files.merge();
        files
    }

    /// Loads `seeds` (path, whether it is a lib, whether it may be dropped) and whatever can be told from there on to be part of the program,
    /// each file as soon as something is seen to refer to it. Which number a file gets, and which of two that are the same package is taken,
    /// goes by the order files refer to each other in. That is gone through afterwards, with all of this at hand.
    fn load_ahead(
        host: &dyn Host,
        resolver: &Resolver,
        options: &Options,
        atoms: &Interner,
        seeds: Vec<(String, bool, bool)>,
    ) -> FxHashMap<String, Box<Loaded>> {
        /// What is next to each other is in the same directory.
        const RUN: usize = 16;
        /// What has been read takes memory until it is worked on.
        const AHEAD: usize = 256;
        struct Shared {
            to_read: std::collections::VecDeque<(String, bool, bool)>,
            ready: Vec<((String, bool, bool), Cow<'static, [u8]>)>,
            seen: FxHashSet<String>,
            seen_packages: FxHashSet<String>,
            /// Taken from `to_read` and not in `done` yet.
            under_way: usize,
            done: FxHashMap<String, Box<Loaded>>,
        }
        let shared = Mutex::new(Shared {
            seen: seeds.iter().map(|seed| seed.0.clone()).collect(),
            to_read: seeds.into(),
            ready: Vec::new(),
            seen_packages: FxHashSet::default(),
            under_way: 0,
            done: FxHashMap::default(),
        });
        let has_changed = std::sync::Condvar::new();
        let threads = host.threads();
        let readers = host.readers().min(threads);
        let arrived = AtomicUsize::new(0);
        host.parallel(threads, &|_| {
            let reads = arrived.fetch_add(1, Ordering::Relaxed) < readers;
            let mut state = shared.lock().unwrap();
            loop {
                if reads && !state.to_read.is_empty() && state.ready.len() <= AHEAD {
                    let count = state.to_read.len().min(RUN);
                    let run: Vec<_> = state.to_read.drain(..count).collect();
                    state.under_way += count;
                    drop(state);
                    for file in run {
                        let text = host.read(&file.0).unwrap_or_default();
                        shared.lock().unwrap().ready.push((file, text));
                        has_changed.notify_one();
                    }
                    state = shared.lock().unwrap();
                } else if let Some(((path, is_lib, may_drop), text)) = state.ready.pop() {
                    drop(state);
                    let loaded = Box::new(Self::load_one(
                        host, resolver, options, atoms, &path, is_lib, may_drop, text,
                    ));
                    // As the waves do, but for what goes by how deep in packages a file is.
                    let found = loaded
                        .references
                        .iter()
                        .map(|(path, is_lib, _)| (path, *is_lib))
                        .chain(
                            loaded
                                .imports
                                .iter()
                                .filter(|(_, _, path, brings_in)| {
                                    *brings_in
                                        && !options.no_resolve
                                        && !(is_javascript(path) && path.contains("/node_modules/"))
                                })
                                .map(|(_, _, path, _)| (path, false)),
                        );
                    let found: Vec<(&String, bool, Option<String>)> = found
                        .map(|(path, is_lib)| (path, is_lib, resolver.package_id(path)))
                        .collect();
                    state = shared.lock().unwrap();
                    let before = state.to_read.len();
                    for (path, is_lib, package) in found {
                        if !state.seen.contains(path)
                            && package.is_none_or(|package| state.seen_packages.insert(package))
                        {
                            state.seen.insert(path.clone());
                            state.to_read.push_back((path.clone(), is_lib, false));
                        }
                    }
                    let has_more = state.to_read.len() > before;
                    state.done.insert(path, loaded);
                    state.under_way -= 1;
                    if has_more || state.under_way == 0 {
                        has_changed.notify_all();
                    }
                } else if state.under_way == 0 && state.to_read.is_empty() {
                    has_changed.notify_all();
                    return;
                } else {
                    state = has_changed.wait(state).unwrap();
                }
            }
        });
        shared.into_inner().unwrap().done
    }

    /// All that goes by the file alone.
    fn parse_and_bind(
        host: &dyn Host,
        options: &Options,
        atoms: &Interner,
        path: &str,
        is_lib: bool,
        says_esm: bool,
        text: Cow<'static, [u8]>,
    ) -> (hir::File, Bound) {
        let mut hir = if path.ends_with(".json") {
            json_to_hir(&text, atoms)
        } else {
            host.parse(path, &text, atoms, options)
        };
        // The default library is not looked into for how it is written, nor is JSON the parser has nothing against.
        if (hir.kind != FileKind::Json || hir.has_parse_diagnostics) && !is_lib {
            hir.text = text;
        }
        // `getExternalModuleIndicator`: what else makes a module of a file that neither imports nor exports.
        if !hir.has_module_syntax && hir.kind != FileKind::Declaration {
            let (mut has_import_meta, mut has_jsx) = (false, false);
            for e in &hir.exprs {
                has_import_meta |= matches!(e.kind, hir::ExprKind::ImportMeta);
                has_jsx |= matches!(e.kind, hir::ExprKind::Jsx(_));
            }
            // Something in the file shows it: `import.meta`, or a tag that imports what it is made with.
            let is_shown = has_import_meta
                || options.module_detection == ModuleDetection::Auto
                    && has_jsx
                    && matches!(options.jsx, JsxEmit::ReactJsx | JsxEmit::ReactJsxDev);
            // `moduleDetection: force`, `isFileForcedToBeModuleByFormat`: the file itself is what shows that it is a module.
            let is_decreed = match options.module_detection {
                ModuleDetection::Force => true,
                ModuleDetection::Legacy => false,
                ModuleDetection::Auto => {
                    says_esm
                        || [".mts", ".cts", ".mjs", ".cjs"]
                            .iter()
                            .any(|&e| path.ends_with(e))
                }
            };
            hir.has_module_syntax = is_shown || is_decreed;
            hir.is_module_by_decree = !is_shown && is_decreed;
        }
        // `GetEmitScriptTarget`: no target is the latest.
        let is_before =
            |target: ScriptTarget| options.target != ScriptTarget::None && options.target < target;
        let bound = bind::bind_with_atoms(
            &hir,
            bind::BindOptions {
                emit_standard_class_fields: options.emit_standard_class_fields,
                before_es2020: is_before(ScriptTarget::ES2020),
                before_es2017: is_before(ScriptTarget::ES2017),
            },
            atoms,
        );
        rename_private_names(&mut hir, &bound, atoms, path);
        (hir, bound)
    }

    /// Has `file` at hand in this thread for as long as what is returned is around. Nothing is to be asked about a file that `is_transient`
    /// otherwise.
    pub fn bring_in(&self, host: &dyn Host, file: FileId) -> AtHand<'_> {
        let cell = &self.modules[file.idx()];
        if !cell.is_transient {
            return AtHand { module: None };
        }
        // SAFETY: nothing refers to the file, so no other thread looks at the module.
        let module = unsafe { &mut *cell.0.get() };
        let mut text = std::mem::take(&mut module.hir.text);
        // It has been at hand before.
        if text.is_empty() && module.hir.source_len > 0 {
            text = host.read(&module.path).unwrap_or_default();
        }
        let (hir, bound) = Self::parse_and_bind(
            host,
            &self.options,
            &self.atoms,
            &module.path,
            module.is_lib,
            module.says_esm,
            text,
        );
        module.hir = hir;
        module.bound = bound;
        crate::local::begin(file.0, std::ptr::null());
        AtHand { module: Some(cell) }
    }

    fn load_one(
        host: &dyn Host,
        resolver: &Resolver,
        options: &Options,
        atoms: &Interner,
        path: &str,
        is_lib: bool,
        may_drop: bool,
        text: Cow<'static, [u8]>,
    ) -> Loaded {
        // `GetImpliedNodeFormatForFile`: a JSON file is neither kind of module, whatever its package says.
        let says_esm = !path.ends_with(".json")
            && (options.resolves_like_node || path.contains("/node_modules/"))
            && resolver.is_ecmascript_module(path);
        let is_esm = options.resolves_like_node && says_esm;
        let implied_format = resolver.implied_format(path);
        let default_mode = options.default_mode(implied_format);
        let package_json_without_type =
            if matches!(options.module, ModuleKind::Node16 | ModuleKind::Node18) {
                resolver
                    .package_json_without_type(path)
                    .map_or(Atom::NONE, |found| atoms.intern(found.as_bytes()))
            } else {
                Atom::NONE
            };
        let (hir, bound) = Self::parse_and_bind(host, options, atoms, path, is_lib, says_esm, text);
        let mut imports = Vec::new();
        let (mut untyped_imports, mut jsx_imports, mut untyped_package_imports) =
            (Vec::new(), Vec::new(), Vec::new());
        let mut untyped_import_files = Vec::new();
        let mut untyped_import_alternates = Vec::new();
        let mut ts_extension_imports = Vec::new();
        let mut arbitrary_extension_imports = Vec::new();
        let mut arbitrary_extension_files = Vec::new();
        let mut extensionless_imports = Vec::new();
        // `resolveImportsAndModuleAugmentations`: with `importHelpers`, a file that can be emitted with helpers imports `tslib`.
        if options.import_helpers
            && (hir.is_js
                || hir.kind != FileKind::Declaration
                    && (options.isolated_modules || hir.has_module_syntax))
            && let Some(found) = resolver.resolve_module("tslib", path, default_mode)
        {
            let tslib = atoms.intern_str("tslib");
            if is_javascript(&found) {
                untyped_imports.push((tslib, default_mode));
                let package = resolver.package_id(&found);
                untyped_import_files.push((
                    atoms.intern(found.as_bytes()),
                    package
                        .as_deref()
                        .and_then(|id| Some(&id[..1 + id.get(1..)?.find('@')?]))
                        .map(|name| atoms.intern(name.as_bytes())),
                ));
            } else {
                imports.push((tslib, default_mode, found, true));
            }
        }
        // Only a file that can have tags in it, going by its name, imports what they are made with.
        if (path.ends_with(".tsx") || path.ends_with(".jsx"))
            && let Some(runtime) = jsx_runtime_of(options, &hir, atoms)
            && let Some(found) = resolver.resolve_as(&runtime, path, default_mode)
        {
            imports.push((atoms.intern_str(&runtime), default_mode, found, true));
        }
        // The arguments of `import()` calls, and of `require()` calls in JavaScript (`ForEachDynamicImportOrRequireCall`).
        let (mut called, mut required): (Vec<Atom>, Vec<Atom>) = (Vec::new(), Vec::new());
        if !bound.specifiers.is_empty() {
            for (i, e) in hir.exprs.iter().enumerate() {
                if matches!(bound.expr_parent[i], bind::Parent::None) {
                    continue;
                }
                match e.kind {
                    ExprKind::ImportCall(argument) => {
                        if let ExprKind::String(spec) = hir[argument].kind {
                            called.push(spec);
                        }
                    }
                    ExprKind::Call(_) if hir.is_js => {
                        required.extend(bind::required_specifier(&hir, ExprId(i as u32)))
                    }
                    _ => {}
                }
            }
        }
        // `collectModuleReferences`: of what the body of `declare module "m"` in a script imports, only what is not relative is looked
        // for. Statements come before `import()` and the like.
        let ambient = bound
            .ambient_specifiers
            .iter()
            .filter(|&&spec| !is_relative(&atoms.text(spec)));
        for &spec in ambient.chain(&bound.specifiers) {
            let text = atoms.text(spec);
            // `isExtensionlessRelativePathImport`. `HasExtension` goes by `GetBaseFileName`, to which one slash at the end is nothing.
            let base = text.strip_suffix('/').unwrap_or(&text);
            let base = &base[base.rfind('/').map_or(0, |i| i + 1)..];
            if options.resolves_like_node
                && (text.starts_with("./") || text.starts_with("../"))
                && !base.contains('.')
            {
                let stem = join(parent_dir(path), &text);
                // `getSuggestedImportExtension`
                let is_there = [
                    ".mts", ".ts", ".cts", ".mjs", ".js", ".cjs", ".tsx", ".jsx", ".json",
                ]
                .iter()
                .any(|e| host.is_file(&format!("{stem}{e}")));
                extensionless_imports.push((spec, is_there));
            }
            // `getModeForUsageLocation`: it is looked for in each way something in the file asks for it, in the order they do.
            let written = hir
                .specifier_uses
                .iter()
                .filter(|u| u.spec == spec)
                .map(|u| {
                    if u.mode != ResolutionMode::None {
                        u.mode
                    } else if u.kind == SpecifierKind::Require {
                        ResolutionMode::Require
                    } else {
                        default_mode
                    }
                });
            let import_call = called
                .contains(&spec)
                .then_some(options.import_call_mode(default_mode));
            // `getEmitSyntaxForUsageLocationWorker`: the argument of `require()` is resolved as CommonJS, whatever the file is emitted as.
            let require_call = required.contains(&spec).then_some(ResolutionMode::Require);
            let mut modes = [default_mode; 3];
            let mut count = 0;
            for mode in written.chain(import_call).chain(require_call) {
                if !modes[..count].contains(&mode) {
                    modes[count] = mode;
                    count += 1;
                }
            }
            let imported = count;
            // What adds to a module looks for it the way the file itself would, whatever else names it. It does not bring it in.
            let is_module_name = bound.ambient_modules.iter().any(|m| m.0 == spec);
            if (count == 0 || is_module_name && hir.has_module_syntax)
                && !modes[..count].contains(&default_mode)
            {
                modes[count] = default_mode;
                count += 1;
            }
            for (i, &mode) in modes[..count].iter().enumerate() {
                match resolver.resolve_module_and_extension(&text, path, mode) {
                    Some((found, _, _)) if is_javascript(&found) => {
                        untyped_imports.push((spec, mode));
                        if let Some(types) = resolver.alternate_result(&text, path, mode) {
                            let types = atoms.intern(types.as_bytes());
                            untyped_import_alternates.push((spec, mode, types));
                        }
                        let package = resolver.package_id(&found);
                        untyped_import_files.push((
                            atoms.intern(found.as_bytes()),
                            // The name can hold a `@` at its start only.
                            package
                                .as_deref()
                                .and_then(|id| Some(&id[..1 + id.get(1..)?.find('@')?]))
                                .map(|name| atoms.intern(name.as_bytes())),
                        ));
                        let is_jsx = found.ends_with(".jsx");
                        if is_jsx {
                            jsx_imports.push((spec, mode));
                        }
                        if found.contains("/node_modules/") {
                            untyped_package_imports.push((spec, mode));
                        }
                        // `shouldAddFile`: with `allowJs`, JavaScript is loaded like any other file, except `.jsx` without the `jsx`
                        // option. `Files::load` skips files too deep inside packages. A file that is not loaded for this import is
                        // still linked if it is in the program for another reason.
                        if options.allow_js {
                            let should_load = !(is_jsx && options.jsx == JsxEmit::None);
                            imports.push((
                                spec,
                                mode,
                                found,
                                should_load && (i < imported || !is_module_name),
                            ));
                        }
                    }
                    // `needAllowArbitraryExtensions`: the file is refused, even if it is in the program for another reason.
                    Some((found, _, true))
                        if hir.kind != FileKind::Declaration
                            && !options.allow_arbitrary_extensions =>
                    {
                        arbitrary_extension_imports.push((spec, mode));
                        arbitrary_extension_files.push(atoms.intern(found.as_bytes()));
                    }
                    Some((found, using_ts_extension, _)) => {
                        if using_ts_extension {
                            ts_extension_imports.push((spec, mode));
                        }
                        imports.push((spec, mode, found, i < imported || !is_module_name));
                    }
                    None => {}
                }
            }
        }
        // They are gone through kind by kind: paths, then types, then libraries.
        let (mut references, mut types, mut libs) = (Vec::new(), Vec::new(), Vec::new());
        let mut missing_references = Vec::new();
        for &(kind, value, pos, mode) in &hir.references {
            // `noResolve`: only libraries are still looked at.
            if options.no_resolve && matches!(kind, ReferenceKind::Path | ReferenceKind::Types) {
                continue;
            }
            let value = atoms.text(value);
            match kind {
                ReferenceKind::Path => {
                    match referenced_file(host, options, &referenced_path(&value, path), path) {
                        Ok(found) => references.push((found, false, false)),
                        Err(code) => missing_references.push((pos, code)),
                    }
                }
                ReferenceKind::Lib => {
                    if options.no_lib {
                        continue;
                    }
                    let name = lib_name(&value);
                    // `GetLibFileName`: whether there is such a library does not depend on what stands in for it.
                    if host.is_file(&format!("{}/lib.{name}.d.ts", options.lib_dir)) {
                        let (found, is_lib) = lib_path(resolver, options, &name);
                        libs.push((found, is_lib, false));
                    } else {
                        missing_references.push((pos, 2726));
                    }
                }
                ReferenceKind::Types => {
                    // `getModeForTypeReferenceDirectiveInFile`
                    let mode = if mode == ResolutionMode::None {
                        implied_format
                    } else {
                        mode
                    };
                    match resolver.resolve_type_reference(&value, parent_dir(path), mode, false) {
                        Some(found) => {
                            // `IsExternalLibraryImport`
                            let is_in_package = found.contains("/node_modules/");
                            types.push((found, false, is_in_package));
                        }
                        None => missing_references.push((pos, 2688)),
                    }
                }
            }
        }
        references.extend(types);
        references.extend(libs);
        let module = Module {
            path: path.to_owned(),
            hir,
            bound,
            is_lib,
            imports: FxHashMap::default(),
            untyped_imports: untyped_imports.into(),
            untyped_import_files: untyped_import_files.into(),
            untyped_import_alternates: untyped_import_alternates.into(),
            jsx_imports: jsx_imports.into(),
            untyped_package_imports: untyped_package_imports.into(),
            ts_extension_imports: ts_extension_imports.into(),
            arbitrary_extension_imports: arbitrary_extension_imports.into(),
            arbitrary_extension_files: arbitrary_extension_files.into(),
            extensionless_imports: extensionless_imports.into(),
            missing_references: missing_references.into(),
            is_esm,
            says_esm,
            implied_format,
            default_mode,
            package_json_without_type,
            edges: Vec::new(),
            redirected_imports: Few::default(),
            is_transient: false,
            adds_nothing: false,
            is_dropped: false,
        };
        let mut module = module;
        module.adds_nothing = !is_lib
            && matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx)
            && !module.hir.is_js
            && module.hir.has_module_syntax
            && module.bound.global_augmentations.is_empty()
            && module.bound.ambient_modules.is_empty()
            && module.bound.umd_globals.is_empty();
        // All the trees of a big program at once are several times what is ever needed afterwards.
        if may_drop && module.adds_nothing && looks_like_a_leaf(path, &module.bound) {
            module.hir = stub_of(&mut module.hir, true);
            module.bound = Bound::default();
            module.is_dropped = true;
        } else {
            module.hir.fit();
            module.bound.fit();
        }
        Loaded {
            module,
            imports,
            references,
        }
    }

    /// What is wrong before any file is looked at: with the options, and with what they name. The codes, in order, each once.
    pub fn configuration_errors(&self) -> Vec<u32> {
        let mut all = self.options.errors.clone();
        all.extend(self.program_errors.iter().map(|problem| problem.code));
        all.sort_unstable();
        all.dedup();
        all
    }

    /// What is wrong with what the options name, no file being to blame. What is wrong with the options themselves is in `options.problems`.
    pub fn program_problems(&self) -> &[Problem] {
        &self.program_errors
    }

    /// The module `file` imports for its JSX without saying so.
    pub fn jsx_runtime(&self, file: FileId) -> Option<Atom> {
        let runtime = jsx_runtime_of(&self.options, &self.modules[file.idx()].hir, &self.atoms)?;
        self.atoms.lookup(runtime.as_bytes())
    }

    // ───────────────────────────── merging ─────────────────────────────

    /// Libs first; then from each starting point depth first, a file after everything it refers to.
    fn declaration_order(&self, starts: &[FileId]) -> Vec<FileId> {
        let mut seen = vec![false; self.modules.len()];
        let mut libs = Vec::new();
        let mut others = Vec::new();
        for &start in starts {
            // (file, how many of its edges have been followed)
            let mut stack: Vec<(FileId, usize)> = Vec::new();
            if !std::mem::replace(&mut seen[start.idx()], true) {
                stack.push((start, 0));
            }
            while let Some(top) = stack.last_mut() {
                let (file, next) = *top;
                match self.modules[file.idx()].edges.get(next) {
                    Some(&edge) => {
                        top.1 += 1;
                        if !std::mem::replace(&mut seen[edge.idx()], true) {
                            stack.push((edge, 0));
                        }
                    }
                    None => {
                        if self.modules[file.idx()].is_lib {
                            libs.push(file)
                        } else {
                            others.push(file)
                        }
                        stack.pop();
                    }
                }
            }
        }
        libs.extend(others);
        libs
    }

    fn merge(&mut self) {
        // `initializeChecker`: file by file, what scripts declare and the names modules go by globally; then what modules add to the
        // global scope.
        let passes = self
            .order
            .iter()
            .map(|&id| (id, false))
            .chain(self.order.iter().map(|&id| (id, true)));
        for (id, augmentations) in passes.collect::<Vec<_>>() {
            let file = id.idx();
            let module = &self.modules[file];
            let mut additions: Vec<(Atom, Sym)> = Vec::new();
            if !augmentations && !module.is_module() {
                let locals = module.bound.scopes[0].locals;
                additions.extend(
                    module
                        .bound
                        .table(locals)
                        .iter()
                        .map(|&(name, s)| (name, Sym { file: id, id: s })),
                );
            }
            if augmentations {
                for &augmentation in &module.bound.global_augmentations {
                    if !is_global_augmentation(module, augmentation) {
                        continue;
                    }
                    let exports = module.bound.symbols[augmentation.idx()].exports;
                    additions.extend(
                        module
                            .bound
                            .table(exports)
                            .iter()
                            .map(|&(name, s)| (name, Sym { file: id, id: s })),
                    );
                }
            }
            let mut i = 0;
            while i < additions.len() {
                let (name, sym) = additions[i];
                i += 1;
                // The built-in `globalThis` is a module whose exports are the globals, and the name goes on meaning it.
                if name == known::globalThis {
                    let flags = self.flags(sym);
                    // `mergeSymbol`: what cannot be one with a module is left out.
                    if SymFlags::MODULE.intersects(excluded_flags(flags)) {
                        continue;
                    }
                    // What a namespace of that name exports is global.
                    if flags.intersects(SymFlags::MODULE) {
                        let bound = &self.modules[sym.file.idx()].bound;
                        let exports = bound.symbols[sym.id.idx()].exports;
                        additions.extend(bound.table(exports).iter().map(|&(n, s)| {
                            (
                                n,
                                Sym {
                                    file: sym.file,
                                    id: s,
                                },
                            )
                        }));
                        continue;
                    }
                }
                // `mergeGlobalSymbol`
                let merged = match self.globals.get(&name).copied() {
                    Some(existing) => self.merge_symbols(existing, sym),
                    None => self.canonical(sym),
                };
                self.globals.insert(name, merged);
            }
            // The first to claim a name has it. What a later file declares under the name of a module is added to the module.
            if !augmentations {
                for (name, symbol) in self.modules[file].bound.umd_globals.clone() {
                    self.globals.entry(name).or_insert(Sym {
                        file: id,
                        id: symbol,
                    });
                }
            }
        }
        // `declare module "name"` in a script declares the module; in a module it adds to one that is there.
        let mut augmentations: Vec<(FileId, Atom, Sym)> = Vec::new();
        for id in self.order.clone() {
            let file = id.idx();
            let is_module = self.modules[file].is_module();
            for (name, symbol) in self.modules[file].bound.ambient_modules.clone() {
                let sym = Sym {
                    file: id,
                    id: symbol,
                };
                if is_module {
                    augmentations.push((id, name, sym));
                    continue;
                }
                // `TryParsePattern`: one `*`, and no more, makes a pattern of the name. It is a name like any other besides.
                let text = self.atoms.text(name).into_owned();
                if let Some(star) = text.find('*')
                    && !text[star + 1..].contains('*')
                {
                    self.ambient_patterns.push((
                        text[..star].to_owned(),
                        text[star + 1..].to_owned(),
                        sym,
                    ));
                }
                match self.ambient_modules.get(&name).copied() {
                    Some(existing) => {
                        self.merge_symbols(existing, sym);
                    }
                    None => {
                        self.ambient_modules.insert(name, sym);
                    }
                }
            }
        }
        for (file, name, sym) in augmentations {
            match self.module_of_specifier_as(file, name, self.module(file).default_mode) {
                // What is added to a module that is `export = ns` is added to `ns`.
                Some(target) => {
                    let target = self.module_value(target);
                    // `mergeModuleAugmentation`: what is `export =` something that is no namespace cannot be added to.
                    if !self.flags(target).intersects(SymFlags::NAMESPACE) {
                        continue;
                    }
                    // `mergeModuleAugmentation`: what is added to `a.svg`, which only the pattern `*.svg` declares, is not added to the
                    // pattern. The addition gets what the pattern has, and goes by its own name. A pattern several scripts declare is
                    // not the symbol of any of them (`mainModule == module.Symbol`), and is added to like any module.
                    if !self.flags(target).contains(SymFlags::MERGED)
                        && self.ambient_patterns.iter().any(|p| p.2 == target)
                    {
                        self.merge_one_way(sym, target);
                        self.pattern_augmentations.insert(name, sym);
                        continue;
                    }
                    // What the module only passes on with `export *` is added to where it is declared.
                    let bound = &self.modules[sym.file.idx()].bound;
                    let added: Vec<(Atom, Sym)> = bound
                        .table(bound.symbols[sym.id.idx()].exports)
                        .iter()
                        .map(|&(n, s)| {
                            (
                                n,
                                Sym {
                                    file: sym.file,
                                    id: s,
                                },
                            )
                        })
                        .collect();
                    let mut passed_on = Vec::new();
                    for (name, addition) in added {
                        if self.export(target, name).is_none()
                            && let Some(found) = self.module_export(target, name)
                            && let Some(found) = self.resolve_alias_if_needed(found)
                        {
                            let found = self.canonical(found);
                            // `mergeSymbol`: what cannot be one symbol stays two, and the module has the addition under the name.
                            if self
                                .flags(found)
                                .intersects(excluded_flags(self.flags(addition)))
                            {
                                self.refused_merges.push((found, addition));
                                continue;
                            }
                            let merged = self.merge_symbols(found, addition);
                            passed_on.push((name, merged));
                        }
                    }
                    self.merge_symbols(target, sym);
                    // The module now has the name itself: it means the whole, not the addition.
                    let target = self.canonical(target);
                    if let Some(table) = self.merged_exports.get_mut(&target) {
                        table.extend(passed_on);
                    }
                }
                // `mergeModuleAugmentation`: what adds to a module that is not there adds to nothing.
                None => {}
            }
        }
        // Each file is gone through once, however many of its names mean something else.
        let mut stand_ins = std::mem::take(&mut self.stand_ins);
        stand_ins.sort_unstable();
        for of_file in stand_ins.chunk_by(|a, b| a.0.file == b.0.file) {
            let stands_in = |symbol: &mut SymbolId| {
                if let Ok(i) = of_file.binary_search_by_key(symbol, |s| s.0.id) {
                    *symbol = of_file[i].1;
                }
            };
            let bound = &mut self.modules[of_file[0].0.file.idx()].bound;
            bound.expr_symbol.iter_mut().for_each(stands_in);
            bound
                .entries
                .iter_mut()
                .map(|e| &mut e.1)
                .for_each(stands_in);
        }
        // What an alias was found to stand for while symbols were being put together may be a part of something by now.
        let symbols = Bases::new(self.modules.iter().map(|m| m.bound.symbols.len()));
        self.aliases = ByNode::new(&symbols);
        self.alias_steps = ByNode::new(&symbols);
        self.memo = Memo::new(&symbols);
        for (&part, &whole) in &self.merged_into {
            self.memo.whole.insert(part, Some(whole));
        }
        for &whole in self.merged_parts.keys() {
            self.memo.whole.insert(whole, Some(whole));
        }
        self.sorted_exports = self
            .merged_exports
            .iter()
            .map(|(&sym, table)| {
                let mut all: Vec<(Atom, Sym)> = table.iter().map(|(&n, &s)| (n, s)).collect();
                all.sort_unstable();
                (sym, all.into_boxed_slice())
            })
            .collect();
        self.is_merged = true;
    }

    fn symbol_mut(&mut self, sym: Sym) -> &mut Symbol {
        &mut self.modules[sym.file.idx()].bound.symbols[sym.id.idx()]
    }

    /// `mergeSymbol`: `source` becomes a part of `target`. The answer is what the name the two go by means from then on.
    fn merge_symbols(&mut self, target: Sym, source: Sym) -> Sym {
        let mut target = self.canonical(target);
        let source = self.canonical(source);
        if target == source {
            return target;
        }
        let source_flags = self.symbol(source).flags;
        // What is added to a name that only stands for something (`IsNonLocalAlias`) is added to what it stands for.
        let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let target_flags = self.symbol(target).flags;
        if target_flags.contains(SymFlags::ALIAS) && !target_flags.intersects(meanings) {
            // Two aliases are never one: the first keeps the name.
            if source_flags.contains(SymFlags::ALIAS) {
                self.refused_merges.push((target, source));
                return target;
            }
            match self.resolve_alias_as(target, meanings) {
                Some(resolved) => {
                    let resolved = self.canonical(resolved);
                    if resolved == source {
                        return source;
                    }
                    // Where the two cannot be one, the addition has the name.
                    if self
                        .symbol(resolved)
                        .flags
                        .intersects(excluded_flags(source_flags))
                    {
                        self.refused_merges.push((target, source));
                        return source;
                    }
                    target = resolved;
                }
                // It may be a property of what a module `export =`s, which only the type of that tells. The alias goes on standing for it.
                None if self.may_be_property_of_export_equals(target) => {}
                // Where the alias leads nowhere (`unknownSymbol`), the addition has the name as well.
                None => {
                    self.record_alias_cycle(target);
                    return source;
                }
            }
        }
        // What cannot be one symbol with what has the name adds nothing to it: two classes, a class and a variable. It stays what its
        // own declarations are about, and the name goes on meaning the first wherever it is used.
        if self
            .symbol(target)
            .flags
            .intersects(excluded_flags(source_flags))
        {
            let refused = self.every_part(source).into_vec();
            for &part in &refused {
                self.name_means_instead(part, target);
            }
            self.symbol_mut(target).flags |= SymFlags::MERGED;
            self.merged_parts
                .entry(target)
                .or_insert_with(|| vec![target]);
            self.every_part
                .entry(target)
                .or_insert_with(|| vec![target])
                .extend(refused);
            return target;
        }
        let source_parts = self
            .merged_parts
            .remove(&source)
            .unwrap_or_else(|| vec![source]);
        let every_source_part = self
            .every_part
            .remove(&source)
            .unwrap_or_else(|| vec![source]);
        self.every_part
            .entry(target)
            .or_insert_with(|| vec![target])
            .extend(every_source_part);
        let target_exports_table = self.symbol(target).exports;
        self.symbol_mut(target).flags |= source_flags | SymFlags::MERGED;
        self.symbol_mut(source).flags |= SymFlags::MERGED;
        self.merged_into.insert(source, target);
        for &part in &source_parts {
            self.merged_into.insert(part, target);
        }
        self.merged_parts
            .entry(target)
            .or_insert_with(|| vec![target])
            .extend(source_parts);

        let source_exports: Vec<(Atom, Sym)> = match self.merged_exports.remove(&source) {
            Some(table) => table.into_iter().collect(),
            None => {
                let bound = &self.modules[source.file.idx()].bound;
                bound
                    .table(bound.symbols[source.id.idx()].exports)
                    .iter()
                    .map(|&(n, s)| {
                        (
                            n,
                            Sym {
                                file: source.file,
                                id: s,
                            },
                        )
                    })
                    .collect()
            }
        };
        if source_exports.is_empty() && target_exports_table.is_none() {
            return target;
        }
        if !self.merged_exports.contains_key(&target) {
            let bound = &self.modules[target.file.idx()].bound;
            let table = bound
                .table(target_exports_table)
                .iter()
                .map(|&(n, s)| {
                    (
                        n,
                        Sym {
                            file: target.file,
                            id: s,
                        },
                    )
                })
                .collect();
            self.merged_exports.insert(target, table);
        }
        let mut sorted = source_exports;
        sorted.sort_unstable();
        // `mergeSymbolTable`
        for (name, sym) in sorted {
            let merged = match self
                .merged_exports
                .get(&target)
                .and_then(|table| table.get(&name))
                .copied()
            {
                Some(existing) => self.merge_symbols(existing, sym),
                None => self.canonical(sym),
            };
            if let Some(table) = self.merged_exports.get_mut(&target) {
                table.insert(name, merged);
            }
        }
        target
    }

    /// Names are looked up in the table the two symbols were to share, which has `target`. The binder has found `refused` for those in
    /// its file. They get a symbol that stands in for `target` there, and the declarations of `refused` keep theirs.
    fn name_means_instead(&mut self, refused: Sym, target: Sym) {
        let bound = &mut self.modules[refused.file.idx()].bound;
        let stand_in = SymbolId(bound.symbols.len() as u32);
        let (name, parent) = {
            let symbol = &bound.symbols[refused.id.idx()];
            (symbol.name, symbol.parent)
        };
        bound.symbols.push(Symbol {
            name,
            flags: SymFlags::MERGED,
            decls: bind::Decls::Many(Box::default()),
            parent,
            exports: bind::TableId::NONE,
        });
        self.stand_ins.push((refused, stand_in));
        self.merged_into.insert(
            Sym {
                file: refused.file,
                id: stand_in,
            },
            target,
        );
    }

    /// `resolveAlias`, `pushTypeResolution`: follows the pure aliases from `start` on and, if they run into a cycle, records the aliases
    /// of the cycle in `circular_at_merge`.
    fn record_alias_cycle(&mut self, start: Sym) {
        let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let mut chain = vec![start];
        while chain.len() < 32 {
            let Some(next) = self
                .alias_target(chain[chain.len() - 1])
                .map(|target| self.canonical(target))
            else {
                return;
            };
            let flags = self.flags(next);
            if !flags.contains(SymFlags::ALIAS) || flags.intersects(meanings) {
                return;
            }
            if let Some(cycle_start) = chain.iter().position(|&alias| alias == next) {
                for &alias in &chain[cycle_start..] {
                    if !self.circular_at_merge.contains(&alias) {
                        self.circular_at_merge.push(alias);
                    }
                }
                return;
            }
            chain.push(next);
        }
    }

    /// `mergeSymbol(target, source, unidirectional)`: `target` gets all that `source` has, and `source` stays what it is.
    fn merge_one_way(&mut self, target: Sym, source: Sym) {
        let (target, source) = (self.canonical(target), self.canonical(source));
        if target == source {
            return;
        }
        let source_flags = self.symbol(source).flags;
        if self.flags(target).intersects(excluded_flags(source_flags)) {
            self.refused_merges.push((target, source));
            return;
        }
        let source_parts = self.parts(source).into_vec();
        let source_exports = self.exports(source);
        let target_exports_table = self.symbol(target).exports;
        self.symbol_mut(target).flags |= source_flags | SymFlags::MERGED;
        self.every_part
            .entry(target)
            .or_insert_with(|| vec![target])
            .extend_from_slice(&source_parts);
        self.merged_parts
            .entry(target)
            .or_insert_with(|| vec![target])
            .extend(source_parts);
        if source_exports.is_empty() && target_exports_table.is_none() {
            return;
        }
        if !self.merged_exports.contains_key(&target) {
            let bound = &self.modules[target.file.idx()].bound;
            let table = bound
                .table(target_exports_table)
                .iter()
                .map(|&(n, s)| {
                    (
                        n,
                        Sym {
                            file: target.file,
                            id: s,
                        },
                    )
                })
                .collect();
            self.merged_exports.insert(target, table);
        }
        for (name, sym) in source_exports {
            match self.merged_exports[&target].get(&name).copied() {
                Some(existing) => self.merge_one_way(existing, sym),
                None => {
                    self.merged_exports
                        .get_mut(&target)
                        .unwrap()
                        .insert(name, sym);
                }
            }
        }
    }

    // ───────────────────────────── symbols ─────────────────────────────

    #[inline]
    pub fn module(&self, file: FileId) -> &Module {
        &self.modules[file.idx()]
    }

    #[inline]
    pub fn hir(&self, file: FileId) -> &hir::File {
        &self.modules[file.idx()].hir
    }

    #[inline]
    pub fn bound(&self, file: FileId) -> &Bound {
        &self.modules[file.idx()].bound
    }

    #[inline]
    pub fn symbol(&self, sym: Sym) -> &Symbol {
        &self.modules[sym.file.idx()].bound.symbols[sym.id.idx()]
    }

    #[inline]
    pub fn sym(&self, file: FileId, id: SymbolId) -> Sym {
        self.canonical(Sym { file, id })
    }

    /// The symbol `sym` is a part of.
    #[inline]
    pub fn canonical(&self, sym: Sym) -> Sym {
        if self.symbol(sym).flags.contains(SymFlags::MERGED) {
            return self.whole_of(sym);
        }
        sym
    }

    /// `canonical` of a symbol that is `MERGED`.
    fn whole_of(&self, sym: Sym) -> Sym {
        match self.memo.whole.get(&sym) {
            Some(Some(whole)) => whole,
            _ => self.merged_into.get(&sym).copied().unwrap_or(sym),
        }
    }

    #[inline]
    pub fn flags(&self, sym: Sym) -> SymFlags {
        self.symbol(sym).flags
    }

    /// Every declaration of `sym`, which is canonical.
    pub fn decls(&self, sym: Sym) -> Vec<(FileId, Decl)> {
        self.decls_of(sym).into_vec()
    }

    /// `decls`, kept for good where there are several.
    pub fn decls_of(&self, sym: Sym) -> List<'_, (FileId, Decl)> {
        let symbol = self.symbol(sym);
        if !symbol.flags.contains(SymFlags::MERGED) {
            match symbol.decls.as_slice() {
                [] => return List::Kept(&[]),
                [decl] => return List::One((sym.file, *decl)),
                _ => {}
            }
        }
        match self.memo.decls.get_ref(&sym) {
            Some(kept) => List::Kept(kept),
            None => List::Kept(self.memo.decls.insert_ref(sym, self.collect_decls(sym))),
        }
    }

    fn collect_decls(&self, sym: Sym) -> Box<[(FileId, Decl)]> {
        if self.symbol(sym).flags.contains(SymFlags::MERGED)
            && let Some(parts) = self.merged_parts.get(&sym)
        {
            return parts
                .iter()
                .flat_map(|&p| self.symbol(p).decls.iter().map(move |&d| (p.file, d)))
                .collect();
        }
        self.symbol(sym)
            .decls
            .iter()
            .map(|&d| (sym.file, d))
            .collect()
    }

    pub fn export(&self, sym: Sym, name: Atom) -> Option<Sym> {
        let symbol = self.symbol(sym);
        if symbol.flags.contains(SymFlags::MERGED)
            && let Some(table) = self.merged_exports.get(&sym)
        {
            return table.get(&name).copied();
        }
        self.bound(sym.file)
            .lookup(symbol.exports, name)
            .map(|id| self.sym(sym.file, id))
    }

    /// The names `sym` exports itself, sorted by name.
    pub fn exports(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        self.each_export(sym).collect()
    }

    /// `exports`, one after the other.
    pub fn each_export(&self, sym: Sym) -> impl ExactSizeIterator<Item = (Atom, Sym)> + '_ {
        let symbol = self.symbol(sym);
        let merged = if symbol.flags.contains(SymFlags::MERGED) {
            self.merged_exports_of(sym)
        } else {
            None
        };
        let own: &[(Atom, SymbolId)] = match merged {
            Some(_) => &[],
            None => self.bound(sym.file).table(symbol.exports),
        };
        Exports {
            files: self,
            file: sym.file,
            own: own.iter(),
            merged: merged.unwrap_or_default().into_iter(),
        }
    }

    /// What `sym`, which is `MERGED`, exports, sorted by name. `None`: what the binder says it does.
    fn merged_exports_of(&self, sym: Sym) -> Option<List<'_, (Atom, Sym)>> {
        if let Some(sorted) = self.sorted_exports.get(&sym) {
            return Some(List::Kept(sorted));
        }
        let table = self.merged_exports.get(&sym)?;
        let mut all: Vec<(Atom, Sym)> = table.iter().map(|(&n, &s)| (n, s)).collect();
        all.sort_unstable();
        Some(List::Own(all))
    }

    pub fn parts(&self, sym: Sym) -> List<'_, Sym> {
        if self.symbol(sym).flags.contains(SymFlags::MERGED)
            && let Some(parts) = self.merged_parts.get(&sym)
        {
            return List::Kept(parts);
        }
        List::One(sym)
    }

    /// `parts`, and what was refused as a part, in the order they came.
    pub fn every_part(&self, sym: Sym) -> List<'_, Sym> {
        if self.symbol(sym).flags.contains(SymFlags::MERGED)
            && let Some(parts) = self.every_part.get(&sym)
        {
            return List::Kept(parts);
        }
        List::One(sym)
    }

    pub fn global(&self, name: Atom, meaning: SymFlags) -> Option<Sym> {
        let sym = *self.globals.get(&name)?;
        self.means(sym, meaning).then_some(sym)
    }

    /// `getSymbol`: whether `sym`, found under a name, counts where `meaning` is wanted. An alias means all that it and what is on the
    /// way to what it stands for mean.
    pub fn means(&self, sym: Sym, meaning: SymFlags) -> bool {
        if meaning.is_empty() {
            return false;
        }
        let flags = self.flags(sym);
        if flags.intersects(meaning) {
            return true;
        }
        if !flags.contains(SymFlags::ALIAS) {
            return false;
        }
        self.symbol_flags(sym).intersects(meaning)
            || meaning.intersects(SymFlags::VALUE) && self.may_be_property_of_export_equals(sym)
    }

    /// `getSymbolFlags`: what `sym` and all that is on the way to what it stands for mean, taken together. Everything if it leads
    /// nowhere.
    #[inline]
    pub fn symbol_flags(&self, sym: Sym) -> SymFlags {
        let flags = self.flags(sym);
        if !flags.contains(SymFlags::ALIAS) {
            return flags;
        }
        let known = self.memo.symbol_flags.raw(sym);
        if known != 0 {
            return SymFlags::from_bits_retain(known & !FLAGS_KNOWN);
        }
        self.symbol_flags_of_alias(sym)
    }

    /// `symbol_flags`, worked out and kept.
    fn symbol_flags_of_alias(&self, sym: Sym) -> SymFlags {
        let circles = RESOLVING.with(|r| r.borrow().circles);
        let flags = self.symbol_flags_uncached(sym);
        // As in `alias_step`. Where no circle was cut short, every step of the way is settled.
        if RESOLVING.with(|r| r.borrow().circles) == circles {
            self.memo
                .symbol_flags
                .set_raw(sym, flags.bits() | FLAGS_KNOWN, false);
        }
        flags
    }

    fn symbol_flags_uncached(&self, sym: Sym) -> SymFlags {
        let mut flags = self.flags(sym);
        // The way gone so far, to know a circle by.
        let mut way = [sym; 32];
        for i in 1..way.len() {
            if !self.flags(way[i - 1]).contains(SymFlags::ALIAS) {
                return flags;
            }
            let Some(next) = self.alias_step(way[i - 1]) else {
                return SymFlags::all();
            };
            let next = self.export_symbol_of_value_symbol_if_exported(next);
            if let Some(start) = way[..i].iter().position(|&s| s == next) {
                // A circle of nothing but aliases leads nowhere. One that has more than an alias in it ends there.
                let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
                return if way[start..i]
                    .iter()
                    .any(|&s| self.flags(s).intersects(meanings))
                {
                    flags
                } else {
                    SymFlags::all()
                };
            }
            flags |= self.flags(next);
            // The static member is a property, which is a value. `EXPORT_VALUE` stands for `SymbolFlagsProperty` here.
            if self.static_member_of_same_name(next).is_some() {
                flags |= SymFlags::EXPORT_VALUE;
            }
            way[i] = next;
        }
        SymFlags::all()
    }

    /// `getExportSymbolOfValueSymbolIfExported`. `declareModuleMember` also declares an exported value in the locals of its container,
    /// as `ExportValue`. If a declaration of the same name that is not exported accepts it there, the two are one local symbol whose
    /// `ExportSymbol` is the exported symbol. The binder keeps two symbols instead: returns the exported one for the local one.
    pub fn export_symbol_of_value_symbol_if_exported(&self, sym: Sym) -> Sym {
        let local = self.symbol(sym);
        if local.parent.is_none() || local.flags.intersects(SymFlags::ALIAS | SymFlags::MERGED) {
            return sym;
        }
        let bound = self.bound(sym.file);
        let Some(exported) = bound.lookup(bound.symbols[local.parent.idx()].exports, local.name)
        else {
            return sym;
        };
        let exported_values = bound.symbols[exported.idx()]
            .flags
            .intersection(SymFlags::VALUE);
        if exported == sym.id
            || exported_values.is_empty()
            || local.flags.intersects(excluded_flags(exported_values))
        {
            return sym;
        }
        self.sym(sym.file, exported)
    }

    /// `declareClassMember`: a static member is declared in the exports of its class, so it is one symbol with the export of the same
    /// name from a namespace merged with the class. Returns the class if `sym` is such an export.
    pub fn static_member_of_same_name(&self, sym: Sym) -> Option<Sym> {
        let symbol = self.symbol(sym);
        if symbol.parent.is_none() {
            return None;
        }
        let class = self.sym(sym.file, symbol.parent);
        if !self.flags(class).contains(SymFlags::CLASS) {
            return None;
        }
        let name = PropKey::Name(symbol.name);
        let has_static_member = self.decls_of(class).iter().any(|&(file, decl)| {
            let Decl::Class(c) = decl else { return false };
            let hir = self.hir(file);
            hir[c].members.iter().any(|m| {
                let member = &hir[m];
                member.flags.contains(Flags::STATIC)
                    && member.key == name
                    && matches!(
                        member.kind,
                        MemberKind::Property
                            | MemberKind::Method
                            | MemberKind::Getter
                            | MemberKind::Setter
                    )
            })
        });
        has_static_member.then_some(class)
    }

    /// `getExternalModuleMember`: what is imported by name from `export = value` may be a property of the value, which only the type of
    /// the value tells. Whether `sym`, or an alias on the way to what it stands for, is imported like that.
    fn may_be_property_of_export_equals(&self, mut sym: Sym) -> bool {
        for _ in 0..32 {
            if !self.flags(sym).contains(SymFlags::ALIAS) {
                return false;
            }
            if self.is_named_import_from_export_equals(sym) {
                return true;
            }
            match self.alias_step(sym) {
                Some(next) if next != sym => sym = next,
                _ => return false,
            }
        }
        false
    }

    /// Whether `getTargetOfAliasDeclaration` of `sym` goes through `getExternalModuleMember` for a module that has `export =`.
    fn is_named_import_from_export_equals(&self, sym: Sym) -> bool {
        let Some((file, decl)) = self.declaration_of_alias_symbol(sym) else {
            return false;
        };
        let hir = self.hir(file);
        let from = match decl {
            Decl::ImportSpec(s) => hir
                .imports
                .iter()
                .find(|i| i.named.range().contains(&s.idx()))
                .map(|i| (i.spec, self.mode_of_import(file, i.mode))),
            Decl::ExportSpec(s) => hir
                .exports
                .iter()
                .find(|x| x.items.range().contains(&s.idx()))
                .map(|x| (x.spec, self.mode_of_import(file, x.mode))),
            // `const { a } = require("m")`
            Decl::Require(pat) => match self.bound(file).required_by(hir, pat) {
                Some((spec, Some(_))) => Some((spec, ResolutionMode::Require)),
                _ => None,
            },
            _ => None,
        };
        from.is_some_and(|(spec, mode)| {
            spec.is_some()
                && self
                    .module_of_specifier_as(file, spec, mode)
                    .is_some_and(|m| self.export(m, known::export_equals).is_some())
        })
    }

    /// `NameResolver.Resolve`: what `name` means in `scope` of `file`.
    pub fn resolve_name(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Option<Sym> {
        let bound = self.bound(file);
        // `lastLocation`: the kind of the scope the search has just left.
        let mut from = ScopeKind::Block;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            // The `infer`s of a conditional type are seen from its true branch, not from the `extends` clause that declares them.
            if !matches!(from, ScopeKind::Extends)
                && let Some(id) = bound.lookup(s.locals, name)
            {
                let sym = self.sym(file, id);
                if self.means(sym, meaning) && bound.is_seen_from(from, self.flags(sym), meaning) {
                    return Some(sym);
                }
            }
            // What a module, a namespace or an enum exports is in scope in it, wherever it was declared. `default` is no name.
            if s.symbol.is_some() && name != known::default {
                // An enum sees its members, which a namespace it is one with does not.
                let visible = match s.kind {
                    ScopeKind::Enum(_) => meaning & SymFlags::ENUM_MEMBER,
                    _ => meaning & MODULE_MEMBER,
                };
                // What only an export specifier put there is not in scope. That is settled before it is asked what it stands for, which
                // may be the very name that is looked for.
                if let Some(sym) = self.export(self.sym(file, s.symbol), name)
                    && !self.flags(sym).contains(SymFlags::EXPORT_ONLY)
                    && self.means(sym, visible)
                {
                    return Some(sym);
                }
            }
            from = s.kind;
            scope = s.parent;
        }
        self.global(name, meaning)
    }

    // ───────────────────────────── modules and aliases ─────────────────────────────

    pub fn file_symbol(&self, file: FileId) -> Sym {
        self.sym(file, self.bound(file).file_symbol)
    }

    /// The module `spec` means in `file`, for those who know the name and not where it is written: what it means to a plain `import`,
    /// or else to what does ask for it there.
    pub fn module_of_specifier(&self, file: FileId, spec: Atom) -> Option<Sym> {
        let module = self.module(file);
        let modes = [
            module.default_mode,
            ResolutionMode::Import,
            ResolutionMode::Require,
            ResolutionMode::None,
        ];
        let mode = modes
            .into_iter()
            .find(|&mode| module.imports.contains_key(&(spec, mode)))
            .unwrap_or(module.default_mode);
        self.module_of_specifier_as(file, spec, mode)
    }

    /// `getModeForUsageLocation` of an import or export declaration or an import type, `written` being what it says about that.
    pub fn mode_of_import(&self, file: FileId, written: ResolutionMode) -> ResolutionMode {
        if written == ResolutionMode::None {
            self.module(file).default_mode
        } else {
            written
        }
    }

    /// `getModeForUsageLocation` of the argument of `import()`.
    pub fn mode_of_import_call(&self, file: FileId) -> ResolutionMode {
        self.options
            .import_call_mode(self.module(file).default_mode)
    }

    /// `resolveExternalModule`: the module `spec` means in `file`, where it is looked for in `mode`.
    pub fn module_of_specifier_as(
        &self,
        file: FileId,
        spec: Atom,
        mode: ResolutionMode,
    ) -> Option<Sym> {
        // The specifier is not a string literal (1141). No ambient pattern may match it.
        if spec.is_none() {
            return None;
        }
        // `tryFindAmbientModule`: nothing is found by a relative name.
        if let Some(&ambient) = self.ambient_modules.get(&spec)
            && !is_relative(&self.atoms.text(spec))
        {
            return Some(self.canonical(ambient));
        }
        // A file that is no module is where the search ends all the same.
        if let Some(&target) = self.module(file).imports.get(&(spec, mode)) {
            return self
                .module(target)
                .is_module()
                .then(|| self.file_symbol(target));
        }
        if !self.ambient_patterns.is_empty() {
            let text = self.atoms.text(spec);
            // `FindBestPatternMatch`: the one with the longest prefix, and of those the first.
            let mut best: Option<(usize, Sym)> = None;
            for (prefix, suffix, sym) in &self.ambient_patterns {
                if best.is_none_or(|b| prefix.len() > b.0)
                    && text.len() >= prefix.len() + suffix.len()
                    && text.starts_with(prefix.as_str())
                    && text.ends_with(suffix.as_str())
                {
                    best = Some((prefix.len(), *sym));
                }
            }
            if let Some((_, pattern)) = best {
                return Some(
                    self.canonical(
                        self.pattern_augmentations
                            .get(&spec)
                            .copied()
                            .unwrap_or(pattern),
                    ),
                );
            }
        }
        None
    }

    /// `module`, or what it says it is with `export =`.
    pub fn module_value(&self, module: Sym) -> Sym {
        match self.export(module, known::export_equals) {
            // `resolveSymbolEx`: only what is nothing but an alias (`IsNonLocalAlias`) is followed.
            Some(equals)
                if self
                    .flags(equals)
                    .intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE) =>
            {
                equals
            }
            Some(equals) => self.resolve_alias(equals).unwrap_or(equals),
            None => module,
        }
    }

    /// `canHaveSyntheticDefault`: the module, or what it says it is with `export =`, if it can have a default that is made up.
    /// `usage` is how the specifier is emitted where it is asked for (`getEmitSyntaxForModuleSpecifierExpression`).
    pub fn synthetic_default(&self, usage: impl Usage, module: Sym) -> Option<Sym> {
        let usage = usage.mode(self);
        // `declare module "m";` has whatever is asked of it, a default too.
        if self
            .decls_of(module)
            .iter()
            .any(|&(f, d)| matches!(d, Decl::Module(id) if !self.hir(f)[id].has_body))
        {
            return None;
        }
        let is_file = self
            .symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File));
        if is_file && usage == ResolutionMode::Import {
            match self.module(module.file).implied_format {
                // To Node a CommonJS module is its own default, whatever it declares.
                ResolutionMode::Require if self.options.module.is_node() => {
                    return Some(self.module_value(module));
                }
                // Between ECMAScript modules nothing is made up.
                ResolutionMode::Import => return None,
                _ => {}
            }
        }
        let can = if !is_file || self.hir(module.file).kind == FileKind::Declaration {
            // One that is only declared may turn out to have one, unless it says what its default is or that it is an ECMAScript module.
            self.export(module, known::default).is_none()
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| self.export(module, name).is_none())
        } else if self.hir(module.file).is_js {
            // JavaScript has one if it has none of the syntax of ECMAScript modules and does not say that it is one.
            let of = self.hir(module.file);
            (!of.has_module_syntax || of.is_module_by_decree)
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| self.export(module, name).is_none())
        } else {
            // `hasExportAssignmentSymbol`: what is written in TypeScript says what its default is, unless it says `export =`.
            self.export(module, known::export_equals).is_some()
        };
        can.then(|| self.module_value(module))
    }

    /// `isOnlyImportableAsDefault`: to Node's `import` a JSON module has a default and nothing else.
    pub fn is_only_importable_as_default(&self, usage: impl Usage, module: Sym) -> bool {
        self.options.module.is_node()
            && usage.mode(self) == ResolutionMode::Import
            && self
                .symbol(module)
                .decls
                .iter()
                .any(|d| matches!(d, Decl::File))
            && (self.hir(module.file).kind == FileKind::Json
                || self.module(module.file).path.ends_with(".d.json.ts"))
    }

    /// `isESMFormatImportImportingCommonjsFormatFile`, of a plain `import` in `from`: a file that is emitted as CommonJS, imported by one
    /// whose `import`s stay `import`s.
    pub fn is_commonjs_to_node(&self, from: FileId, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && self.module(from).default_mode == ResolutionMode::Import
            && self.module(module.file).implied_format == ResolutionMode::Require
    }

    /// The import is emitted as `require` (`getEmitSyntaxForModuleSpecifierExpression`, see `synthetic_default` for `usage`), and
    /// `module` is a file that is emitted as an ECMAScript module (`GetImpliedNodeFormatForEmit`).
    pub fn is_commonjs_import_of_esm_file(&self, usage: impl Usage, module: Sym) -> bool {
        self.symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File))
            && usage.mode(self) == ResolutionMode::Require
            && self.module(module.file).implied_format == ResolutionMode::Import
    }

    /// `InternalSymbolNameModuleExports`. From Node 20 on, `require` of an ECMAScript module returns its export named `"module.exports"`,
    /// if it has one. `None` unless `module` is `node20` .. `nodenext`.
    pub fn module_exports_name(&self) -> Option<Atom> {
        if !(ModuleKind::Node20..=ModuleKind::NodeNext).contains(&self.options.module) {
            return None;
        }
        self.atoms.lookup(b"module.exports")
    }

    /// `getExportOfModule(symbol, "module.exports")`
    pub fn module_exports_export(&self, symbol: Sym) -> Option<Sym> {
        if !self.flags(symbol).intersects(SymFlags::MODULE) {
            return None;
        }
        self.module_export(symbol, self.module_exports_name()?)
    }

    /// `getTargetOfImportEqualsDeclaration`: the target of `import x = require(..)` and of `const x = require(..)` of `module`.
    fn required_module_value(&self, module: Sym) -> Sym {
        let value = self.module_value(module);
        self.module_exports_export(value).unwrap_or(value)
    }

    /// `getTargetOfImportEqualsDeclaration`: the `"module.exports"` export that `pat`, the `x` of `const x = require(..)`, stands for.
    pub fn required_module_exports(&self, file: FileId, pat: PatId) -> Option<Sym> {
        let (spec, None) = self.bound(file).required_by(self.hir(file), pat)? else {
            return None;
        };
        let module = self.module_of_specifier_as(file, spec, ResolutionMode::Require)?;
        self.module_exports_export(self.module_value(module))
    }

    /// `getTargetOfModuleDefault`: what `default` of `module` is to an import or export declaration in `file`. A default that is made up
    /// goes before one that is declared.
    pub fn default_of_module(&self, file: FileId, module: Sym) -> Option<Sym> {
        // `resolveExportByName`: only the exports the module declares itself. With `export =` it is a property of the value instead.
        if self.is_commonjs_import_of_esm_file(file, module)
            && self.export(module, known::export_equals).is_none()
            && let Some(name) = self.module_exports_name()
            && let Some(found) = self.export(module, name)
        {
            return Some(found);
        }
        if let Some(made_up) = self.synthetic_default(file, module) {
            return Some(made_up);
        }
        // `hasDefaultOnly`. A JSON file itself always has one that is made up.
        if self.hir(module.file).kind != FileKind::Json
            && self.is_only_importable_as_default(file, module)
        {
            return Some(self.module_value(module));
        }
        self.module_export(module, known::default)
    }

    /// What importing `name` from `module` gives.
    pub fn module_export(&self, module: Sym, name: Atom) -> Option<Sym> {
        let value = self.module_value(module);
        if value == module {
            return self.export_or_passed_on(module, name);
        }
        // `getExportsOfModuleWorker`: what it says it is with `export =` exports for it, with the `export *` of that and none of its own.
        // That is not its `default`: whether it has one is up to `canHaveSyntheticDefault`.
        // Of what the module exports besides, only what is a type or a namespace and no value counts.
        self.export_or_passed_on(value, name).or_else(|| {
            let own = self.export(module, name)?;
            let flags = self.symbol_flags(own);
            (flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
                && !flags.intersects(SymFlags::VALUE))
            .then_some(own)
        })
    }

    /// `getExportsOfModuleWorker`: what `module` exports itself, or passes on with `export *`.
    fn export_or_passed_on(&self, module: Sym, name: Atom) -> Option<Sym> {
        if let Some(found) = self.export(module, name) {
            return Some(found);
        }
        if name == known::default {
            return None;
        }
        if !self.is_merged {
            return self.module_export_inner(module, name, &mut FxHashSet::default());
        }
        if self.export_stars_of(module).is_empty() {
            return None;
        }
        let all = self.all_exports_of(module);
        all.binary_search_by_key(&name, |export| export.0)
            .ok()
            .map(|i| all[i].1)
    }

    /// What `module` passes on with `export *`, in the order it says so: the module, if the specifier leads to one, and whether it
    /// says `export type *`.
    pub fn export_stars_of(&self, module: Sym) -> &[(Option<Sym>, bool)] {
        if self
            .parts(module)
            .iter()
            .all(|part| self.bound(part.file).export_stars.is_empty())
        {
            return &[];
        }
        if let Some(kept) = self.memo.export_stars.get_ref(&module) {
            return kept;
        }
        let mut stars = Vec::new();
        for part in self.parts(module) {
            let bound = self.bound(part.file);
            for (i, &(container, spec)) in bound.export_stars.iter().enumerate() {
                if container == part.id {
                    stars.push((
                        self.module_of_specifier(part.file, spec),
                        bound.export_star_type_only[i],
                    ));
                }
            }
        }
        self.memo.export_stars.insert_ref(module, stars.into())
    }

    /// Whether all there is to import from `module` can be told. What `export =` gives has properties, which can be imported as well.
    /// `declare module "m";` has whatever is asked of it. What a JSON file has is up to what is in it. The same goes for what is
    /// passed on with `export *`, and nothing is known of what that leads to if it leads nowhere.
    pub fn has_known_exports(&self, module: Sym) -> bool {
        if let Some(known) = self.memo.has_known_exports.get(&module) {
            return known;
        }
        self.memo
            .has_known_exports
            .insert(module, self.has_known_exports_uncached(module))
    }

    fn has_known_exports_uncached(&self, module: Sym) -> bool {
        let is_open = |m: Sym| {
            self.export(m, known::export_equals).is_some()
                || self.symbol(m).exports.is_none()
                || self
                    .decls_of(m)
                    .iter()
                    .any(|&(f, d)| matches!(d, Decl::Module(id) if !self.hir(f)[id].has_body))
                || self.module(m.file).path.ends_with(".json")
        };
        if is_open(module) {
            return false;
        }
        let mut pending = vec![module];
        let mut visited = FxHashSet::default();
        visited.insert(module);
        while let Some(m) = pending.pop() {
            for &(target, _) in self.export_stars_of(m) {
                let Some(target) = target else {
                    return false;
                };
                if is_open(target) {
                    return false;
                }
                if visited.insert(target) {
                    pending.push(target);
                }
            }
        }
        true
    }

    /// `visit` of `getExportsOfModuleWorker`, while symbols are being put together: what `module` exports itself, or passes on with
    /// `export *`. An `export =` of what is passed on counts for nothing.
    fn module_export_inner(
        &self,
        module: Sym,
        name: Atom,
        visited: &mut FxHashSet<Sym>,
    ) -> Option<Sym> {
        if !visited.insert(module) {
            return None;
        }
        if let Some(found) = self.export(module, name) {
            return Some(found);
        }
        if name == known::default {
            return None;
        }
        for part in self.parts(module) {
            for &(container, spec) in &self.bound(part.file).export_stars {
                if container != part.id {
                    continue;
                }
                if let Some(target) = self.module_of_specifier(part.file, spec)
                    && let Some(found) = self.module_export_inner(target, name, visited)
                {
                    return Some(found);
                }
            }
        }
        None
    }

    /// Everything `module` exports, `export *` included. Sorted by name.
    pub fn all_module_exports(&self, module: Sym) -> Vec<(Atom, Sym)> {
        let mut out: FxHashMap<Atom, Sym> = FxHashMap::default();
        let mut visited = FxHashSet::default();
        self.collect_exports(module, &mut out, &mut visited, true);
        let mut all: Vec<(Atom, Sym)> = out.into_iter().collect();
        all.sort_unstable();
        all
    }

    /// `all_module_exports`, kept for good.
    pub fn all_exports_of(&self, module: Sym) -> &[(Atom, Sym)] {
        if let Some(kept) = self.memo.all_exports.get_ref(&module) {
            return kept;
        }
        self.memo
            .all_exports
            .insert_ref(module, self.all_module_exports(module).into())
    }

    fn collect_exports(
        &self,
        module: Sym,
        out: &mut FxHashMap<Atom, Sym>,
        visited: &mut FxHashSet<Sym>,
        with_default: bool,
    ) {
        if !visited.insert(module) {
            return;
        }
        for (name, sym) in self.each_export(module) {
            if name == known::default && !with_default {
                continue;
            }
            out.entry(name).or_insert(sym);
        }
        for &(target, _) in self.export_stars_of(module) {
            if let Some(target) = target {
                self.collect_exports(target, out, visited, false);
            }
        }
    }

    /// `typeOnlyExportStarMap`: whether `module` has `name` only by way of an `export type *`.
    pub fn is_type_only_star_export(&self, module: Sym, name: Atom) -> bool {
        if !self.has_type_only_stars {
            return false;
        }
        let module = self.module_value(module);
        let names = match self.type_only_star_names.get_ref(&module) {
            Some(names) => names,
            None => {
                let (mut visited, mut plain, mut type_only) =
                    (Vec::new(), FxHashSet::default(), FxHashSet::default());
                self.visit_export_stars(
                    module,
                    false,
                    false,
                    &mut visited,
                    &mut plain,
                    &mut type_only,
                );
                let mut names: Vec<Atom> = type_only.difference(&plain).copied().collect();
                names.sort_unstable();
                self.type_only_star_names.insert_ref(module, names.into())
            }
        };
        names.binary_search(&name).is_ok()
    }

    /// `visit` of `getExportsOfModuleWorker`, for the names alone: those `module` exports, `export *` included. `through_type_only`: the
    /// `export *` that led here says `type`. `is_type_only`: that one or one before it does. `plain` gets the names that are reached
    /// without any that does (`nonTypeOnlyNames`), `type_only` those that come through one.
    fn visit_export_stars(
        &self,
        module: Sym,
        through_type_only: bool,
        is_type_only: bool,
        visited: &mut Vec<Sym>,
        plain: &mut FxHashSet<Atom>,
        type_only: &mut FxHashSet<Atom>,
    ) -> Option<FxHashSet<Atom>> {
        // Before it is asked whether it has been here: a plain `export *` takes back what an `export type *` of the same module said.
        if !is_type_only {
            plain.extend(self.each_export(module).map(|e| e.0));
        }
        if visited.contains(&module) {
            return None;
        }
        visited.push(module);
        let mut names: FxHashSet<Atom> = self.each_export(module).map(|e| e.0).collect();
        for &(target, says_type) in self.export_stars_of(module) {
            let Some(target) = target else {
                continue;
            };
            if let Some(nested) = self.visit_export_stars(
                target,
                says_type,
                is_type_only || says_type,
                visited,
                plain,
                type_only,
            ) {
                // `extendExportSymbols`: a default is not passed on.
                names.extend(nested.into_iter().filter(|&n| n != known::default));
            }
        }
        if through_type_only {
            type_only.extend(names.iter().copied());
        }
        Some(names)
    }

    /// `A.B.C` in `scope`: namespaces up to the last name, which has to have `meaning`.
    pub fn resolve_entity(
        &self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: SymFlags,
    ) -> Option<Sym> {
        let (&last, qualifiers) = names.split_last()?;
        if qualifiers.is_empty() {
            return self.resolve_name(file, scope, last, meaning);
        }
        let mut qualifiers = qualifiers;
        let first = match self.resolve_name(file, scope, qualifiers[0], SymFlags::NAMESPACE) {
            Some(found) => found,
            // `globalThis.A.B`
            None if qualifiers[0] == known::globalThis => match qualifiers {
                [_] => return self.global(last, meaning),
                [_, next, ..] => {
                    qualifiers = &qualifiers[1..];
                    self.global(*next, SymFlags::NAMESPACE)?
                }
                [] => return None,
            },
            None => return None,
        };
        let mut container = self.resolve_alias_as(first, SymFlags::NAMESPACE)?;
        for &name in &qualifiers[1..] {
            container = self.member_as(container, name, SymFlags::NAMESPACE)?;
            container = self.resolve_alias_as(container, SymFlags::NAMESPACE)?;
        }
        self.member_as(container, last, meaning)
    }

    /// `resolveQualifiedName`: what `namespace` exports under `name`, which counts only if it has the meaning that is wanted.
    fn member_as(&self, namespace: Sym, name: Atom, meaning: SymFlags) -> Option<Sym> {
        let find = |namespace: Sym| {
            self.namespace_member(namespace, name)
                .filter(|&member| self.means(member, meaning))
        };
        find(namespace).or_else(|| {
            // A namespace that is one with a re-export can be resolved further (`resolveAlias`).
            if !self.flags(namespace).contains(SymFlags::ALIAS) {
                return None;
            }
            find(self.resolve_alias_as(
                self.alias_step(namespace)?,
                SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
            )?)
        })
    }

    /// A member of a namespace, a module or an enum.
    pub fn namespace_member(&self, container: Sym, name: Atom) -> Option<Sym> {
        if self.flags(container).intersects(SymFlags::MODULE) {
            return self.module_export(container, name);
        }
        self.export(container, name)
    }

    #[inline]
    pub fn resolve_alias_if_needed(&self, sym: Sym) -> Option<Sym> {
        if self.flags(sym).contains(SymFlags::ALIAS) {
            self.resolve_alias(sym)
        } else {
            Some(sym)
        }
    }

    /// What an import, an `export { }` or an `export default name` stands for, however many steps away.
    pub fn resolve_alias(&self, sym: Sym) -> Option<Sym> {
        if !self.flags(sym).contains(SymFlags::ALIAS) {
            return Some(sym);
        }
        if let Some(known) = self.aliases.get(&sym) {
            return known;
        }
        let is_circle = RESOLVING.with(|r| {
            let mut r = r.borrow_mut();
            let is_circle = r.ends.contains(&sym);
            if is_circle {
                r.circles += 1
            } else {
                r.ends.push(sym)
            }
            is_circle
        });
        if is_circle {
            return None;
        }
        let target = self.alias_step(sym).and_then(|t| {
            if t == sym {
                None
            } else {
                self.resolve_alias(t)
            }
        });
        RESOLVING.with(|r| r.borrow_mut().ends.pop());
        self.aliases.insert(sym, target)
    }

    /// The loop at the end of `resolveEntityName`: the first symbol from `sym` on that has `meaning` itself; where the way ends if none
    /// has.
    pub fn resolve_alias_as(&self, mut sym: Sym, meaning: SymFlags) -> Option<Sym> {
        for _ in 0..32 {
            let flags = self.flags(sym);
            if flags.intersects(meaning) || !flags.contains(SymFlags::ALIAS) {
                return Some(sym);
            }
            let next = self.alias_step(sym)?;
            if next == sym {
                return None;
            }
            sym = next;
        }
        None
    }

    /// `alias_target`, worked out once. Nothing while it is being worked out: the alias goes in a circle then.
    fn alias_step(&self, sym: Sym) -> Option<Sym> {
        if let Some(known) = self.alias_steps.get(&sym) {
            return known;
        }
        let circles = RESOLVING.with(|r| {
            let mut r = r.borrow_mut();
            if r.steps.contains(&sym) {
                r.circles += 1;
                return None;
            }
            r.steps.push(sym);
            Some(r.circles)
        })?;
        let target = self.alias_target(sym).map(|t| self.canonical(t));
        let is_settled = RESOLVING.with(|r| {
            let mut r = r.borrow_mut();
            r.steps.pop();
            r.circles == circles
        });
        // What was found while a circle was cut short depends on where the circle was entered.
        if is_settled {
            self.alias_steps.insert(sym, target)
        } else {
            target
        }
    }

    /// `IsAliasSymbolDeclaration`
    fn is_alias_symbol_declaration(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        let mut e = match decl {
            Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportSpec(_)
            | Decl::ImportEquals(_)
            | Decl::ExportSpec(_)
            | Decl::ExportStarAs(_)
            | Decl::UmdGlobal(_)
            | Decl::Require(_) => return true,
            Decl::ExportExpr(stmt) => match hir[stmt].kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                _ => return false,
            },
            Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                match hir[assignment].kind {
                    ExprKind::Assign { value, .. } => value,
                    _ => return false,
                }
            }
            _ => return false,
        };
        // `ExpressionIsAlias`: a class expression or an entity name expression. Neither is written in parentheses, which have no node
        // in the HIR.
        let is_parenthesized = |e: ExprId| hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_ok();
        if matches!(hir[e].kind, ExprKind::Class(_)) {
            return !is_parenthesized(e);
        }
        loop {
            if is_parenthesized(e) {
                return false;
            }
            match hir[e].kind {
                ExprKind::Ident(_) => return true,
                ExprKind::Dot { obj, .. } => e = obj,
                _ => return false,
            }
        }
    }

    /// `getDeclarationOfAliasSymbol`: the last alias declaration of `sym`, in whichever file it is. `Symbol::decls` also lists the
    /// declarations `declareSymbolEx` refused, which are not declarations of the symbol: an import excludes every other alias
    /// (`AliasExcludes`), so an import that follows an alias declaration was refused.
    pub fn declaration_of_alias_symbol(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let decls = self.decls_of(sym);
        (0..decls.len()).rev().find_map(|i| {
            let (file, decl) = decls[i];
            if !self.is_alias_symbol_declaration(file, decl) {
                return None;
            }
            let is_import = matches!(
                decl,
                Decl::ImportDefault(_)
                    | Decl::ImportNamespace(_)
                    | Decl::ImportSpec(_)
                    | Decl::ImportEquals(_)
                    | Decl::Require(_)
            );
            let is_refused = is_import
                && decls[..i].iter().any(|&(other, earlier)| {
                    other == file && self.is_alias_symbol_declaration(other, earlier)
                });
            (!is_refused).then_some((file, decl))
        })
    }

    /// One step: what the alias is declared to stand for, which may be an alias again.
    pub fn alias_target(&self, sym: Sym) -> Option<Sym> {
        // `aliasTarget` is `unknownSymbol`.
        if self.circular_at_merge.contains(&sym) {
            return None;
        }
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let (file, decl) = self.declaration_of_alias_symbol(sym)?;
        let hir = self.hir(file);
        let bound = self.bound(file);
        match decl {
            Decl::ImportDefault(import) => {
                let module = self.module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )?;
                self.default_of_module(file, module)
            }
            Decl::ImportNamespace(import) => {
                let module = self.module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )?;
                let value = self.module_value(module);
                // `resolveESModuleSymbol`
                if self.is_commonjs_import_of_esm_file(file, module)
                    && let Some(found) = self.module_exports_export(value)
                {
                    return Some(found);
                }
                Some(value)
            }
            Decl::ImportSpec(spec) => {
                let import = hir
                    .imports
                    .iter()
                    .find(|i| i.named.range().contains(&spec.idx()))?;
                let module = self.module_of_specifier_as(
                    file,
                    import.spec,
                    self.mode_of_import(file, import.mode),
                )?;
                // `getTargetOfImportSpecifier`: `{ default as d }` is the default import by another spelling.
                if hir[spec].imported == known::default {
                    return self.default_of_module(file, module);
                }
                self.module_export(module, hir[spec].imported)
            }
            Decl::ImportEquals(import) => match hir[import].target {
                ImportEqualsTarget::Require(spec) => Some(self.required_module_value(
                    self.module_of_specifier_as(file, spec, ResolutionMode::Require)?,
                )),
                ImportEqualsTarget::Entity(names) => {
                    let names: SmallVec<[Atom; 4]> = hir.ids(names).collect();
                    // `getSymbolOfPartOfRightHandSideOfImportEquals`: `import a = b` is about a namespace, `import a = b.c` about anything.
                    let meaning = if names.len() == 1 {
                        SymFlags::NAMESPACE
                    } else {
                        all
                    };
                    self.resolve_entity(
                        file,
                        bound.import_equals_scope[import.idx()],
                        &names,
                        meaning,
                    )
                }
            },
            Decl::ExportSpec(spec) => {
                let (index, export) = hir
                    .exports
                    .iter()
                    .enumerate()
                    .find(|(_, e)| e.items.range().contains(&spec.idx()))?;
                if export.spec.is_some() {
                    let module = self.module_of_specifier_as(
                        file,
                        export.spec,
                        self.mode_of_import(file, export.mode),
                    )?;
                    // `getTargetOfExportSpecifier`: so is `export { default } from`.
                    if hir[spec].local == known::default {
                        return self.default_of_module(file, module);
                    }
                    return self.module_export(module, hir[spec].local);
                }
                self.resolve_name(file, bound.export_scope[index], hir[spec].local, all)
            }
            Decl::UmdGlobal(_) => Some(self.module_value(self.file_symbol(file))),
            Decl::ExportStarAs(stmt) => {
                let StmtKind::ExportStar { spec, mode, .. } = hir[stmt].kind else {
                    return None;
                };
                Some(self.module_value(self.module_of_specifier_as(
                    file,
                    spec,
                    self.mode_of_import(file, mode),
                )?))
            }
            // `getTargetOfImportEqualsDeclaration` for the whole of what is required, `getTargetOfImportSpecifier` for a part.
            Decl::Require(pat) => {
                let (spec, part) = bound.required_by(hir, pat)?;
                let module = self.module_of_specifier_as(file, spec, ResolutionMode::Require)?;
                match part {
                    None => Some(self.required_module_value(module)),
                    Some(name) => self.module_export(module, name),
                }
            }
            Decl::ExportExpr(_) | Decl::ModuleExports(_) | Decl::ExportsProperty(_) => {
                let e = match decl {
                    Decl::ExportExpr(stmt) => match hir[stmt].kind {
                        StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => e,
                        _ => return None,
                    },
                    // `getTargetOfBinaryExpression`
                    Decl::ModuleExports(assignment) | Decl::ExportsProperty(assignment) => {
                        match hir[assignment].kind {
                            ExprKind::Assign { value, .. } => value,
                            _ => return None,
                        }
                    }
                    _ => return None,
                };
                // `getTargetOfAliasLikeExpression`: a class expression is its own symbol.
                if let ExprKind::Class(c) = hir[e].kind {
                    return Some(self.sym(file, bound.class_symbol[c.idx()]));
                }
                let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
                let mut at = e;
                loop {
                    match hir[at].kind {
                        ExprKind::Ident(name) => {
                            names.push(name);
                            break;
                        }
                        ExprKind::Dot { obj, name, .. } => {
                            names.push(name);
                            at = obj;
                        }
                        _ => return None,
                    }
                }
                names.reverse();
                self.resolve_entity(file, *bound.expr_scope.get(&e)?, &names, all)
            }
            _ => None,
        }
    }
}
