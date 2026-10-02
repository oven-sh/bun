//! Every file of the program, and what its symbols are once the files are put together: which file an import means,
//! which declarations in different files are one symbol, what an alias stands for.

use crate::atom::{Atom, Interner, known, number_to_string};
use crate::bind::{
    self, Bound, Decl, MemberDeclaration, MemberKey, MemberOwner, ScopeId, ScopeKind, SymFlags,
    Symbol, SymbolId, member_flags,
};
use crate::hir::{self, *};
use crate::json::{Expression, ExpressionKind, Json, PropertyName};
use crate::resolve::{
    Host, JsxEmit, ModuleDetection, ModuleKind, Options, Phase, Resolver, ScriptTarget, Spent,
    is_javascript, is_relative, join, known_extension, lib_name, parent_dir,
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
    /// `GetResolutionDiagnostic`, `needJsx`: the specifiers that resolve to a `.tsx` or `.jsx` file while `jsx` is not set, with the mode
    /// they are resolved in and `ResolvedFileName`. The file is not brought into the program for them (6142).
    pub jsx_imports: Few<(Atom, ResolutionMode, Atom)>,
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
    /// Those of `imports` that resolve to a declaration file of a referenced project, for which its source is loaded.
    pub project_reference_imports: Few<(Atom, ResolutionMode)>,
    /// The files it refers to, in the order it does: `/// <reference>`s, then imports.
    pub edges: Vec<FileId>,
    /// `IsSourceFileFromExternalLibrary`: `lowestDepth > 0`, every way to it from a root file leads into a `node_modules`.
    pub is_from_external_library: bool,
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

/// A table `NameResolver.Resolve` looks into.
#[derive(Copy, Clone)]
pub enum SymbolTable {
    /// `location.Locals()`
    Locals(FileId, ScopeId),
    /// `symbol.Exports`
    Exports(Sym),
    Globals,
}

pub struct Files {
    pub atoms: Interner,
    pub options: Options,
    pub modules: Vec<ModuleCell>,
    pub by_path: FxHashMap<String, FileId>,

    pub globals: FxHashMap<Atom, Sym>,
    /// `globalThisSymbol`: a module no file declares, which is in `globals` and whose `Exports` they are. A symbol of the first file.
    pub global_this_symbol: Sym,
    ambient_modules: FxHashMap<Atom, Sym>,
    /// `declare module "*.svg"`
    ambient_patterns: Vec<(String, String, Sym)>,
    /// `patternAmbientModuleAugmentations`: by the name written, what `declare module "a.svg"` in a module makes of `declare module "*.svg"`.
    pattern_augmentations: FxHashMap<Atom, Sym>,
    /// `mergedSymbols`
    merged_symbols: FxHashMap<Sym, Sym>,
    /// `symbol.Declarations` of a transient symbol: the symbols of the binder that have them, in the order they were merged.
    merged_parts: FxHashMap<Sym, Vec<Sym>>,
    /// `merged_parts`, and among them, in the order they came, those that could not be made one with what was there before. They add
    /// nothing to the symbol. They are errors.
    every_part: FxHashMap<Sym, Vec<Sym>>,
    /// While symbols are put together: `name_means_instead`.
    stand_ins: Vec<(Sym, SymbolId)>,
    /// `symbol.Exports` of a transient symbol.
    merged_exports: FxHashMap<Sym, FxHashMap<Atom, Sym>>,
    /// The tables of `merged_exports` sorted by name, once symbols are put together.
    sorted_exports: FxHashMap<Sym, Box<[(Atom, Sym)]>>,
    /// `symbol.Declarations` of the symbols of members that are declared in more than one part of a class or an interface.
    merged_members: Vec<Box<[(FileId, MemberDeclaration)]>>,
    /// Which of `merged_members`, by the first declaration in each part.
    merged_member: FxHashMap<(FileId, MemberDeclaration), u32>,
    /// The pairs `mergeSymbol` refused to make one symbol of, where what a module passes on with `export *`, what a pattern declares or
    /// a name that only stands for something was added to: what was there, and what was to be added.
    pub refused_merges: Vec<(Sym, Sym)>,
    /// The aliases `resolveAlias` found to be circular (2303) while `mergeSymbol` resolved the target of a merge. Their `aliasTarget`
    /// stays `unknownSymbol`, even if the merge breaks the cycle.
    pub circular_at_merge: Vec<Sym>,
    /// Some file says `export type * from`.
    has_type_only_stars: bool,

    /// `aliasSymbolLinks`. An entry is a pure function of the program: it is the same whoever asks first, and from whichever thread.
    alias_symbol_links: ByNodeKept<Sym, AliasSymbolLinks>,
    /// Symbols are put together: nothing about them changes any more.
    is_merged: bool,
    memo: Memo,
    /// The order in which declarations of one thing in several files count: it decides the order of overloads.
    order: Vec<FileId>,
    /// Where each file is in `order`, by `FileId`.
    ranks: Vec<u32>,
    /// What is wrong with what the options name, no file being to blame.
    program_errors: Vec<Problem>,
    /// `GetIncludeProcessorDiagnostics`: what is wrong with a file being in the program, reported where another file refers to it:
    /// that file, from where to where.
    include_errors: Vec<(FileId, u32, u32, Problem)>,
    /// The `package.json` of each package in a `node_modules` that a file of the program is in, by its directory. Only where declaration
    /// files are emitted, which have to call such files something.
    pub package_jsons: FxHashMap<String, Json>,
    /// `DirectoriesByRealpath`: each directory that is known to be linked, with a link to it, in order. Only where declaration files are
    /// emitted. The `package.json` of each is in `package_jsons` under the path of the link.
    pub linked_directories: Vec<(String, String)>,
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
    /// `moduleSymbolLinks`
    module_links: ByNodeKept<Sym, ModuleSymbolLinks>,
    has_known_exports: ByNode<Sym, bool>,
}

/// `ExportCollision`, one for each of its `exportsWithDuplicate`: 2308.
#[derive(Copy, Clone, Debug)]
pub struct ExportCollision {
    /// The `export *` that exports `name` again.
    pub duplicate: (FileId, StmtId),
    /// The one that did first. `specifierText` is its specifier.
    pub first: (FileId, StmtId),
    pub name: Atom,
}

/// `ModuleSymbolLinks`
#[derive(Default)]
pub struct ModuleSymbolLinks {
    /// `resolvedExports`, sorted by name.
    pub resolved_exports: Box<[(Atom, Sym)]>,
    /// `typeOnlyExportStarMap`, sorted by name: the `export type *`.
    pub type_only_export_star_map: Box<[(Atom, (FileId, StmtId))]>,
    /// What `getExportsOfModuleWorker` reports of the `export *` of the module itself.
    pub export_collisions: Box<[ExportCollision]>,
}

/// What `getExportsOfModuleWorker` keeps while `visit` goes from module to module.
#[derive(Default)]
struct ExportsVisit {
    visited_symbols: Vec<Sym>,
    non_type_only_names: FxHashSet<Atom>,
    type_only_export_star_map: FxHashMap<Atom, (FileId, StmtId)>,
    export_collisions: Vec<ExportCollision>,
}

/// No flag of a symbol.
const FLAGS_KNOWN: u32 = 1 << 31;

impl Memo {
    fn new(symbols: &Bases) -> Memo {
        Memo {
            whole: ByNode::new(symbols),
            symbol_flags: ByNode::new(symbols),
            decls: ByNodeKept::new(symbols),
            module_links: ByNodeKept::new(symbols),
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
    /// (specifier, the way it is looked for, what it resolved to, whether that is brought into the program for it, `increaseDepth`)
    imports: Vec<(Atom, ResolutionMode, String, bool, bool)>,
    /// (path, is a lib, `increaseDepth`)
    references: Vec<(String, bool, bool)>,
}

/// `typeOnlyDeclaration`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TypeOnlyDeclaration {
    /// This declaration, in this file, of this alias.
    Alias(Sym, FileId, Decl),
    /// The `export type *` a name came through.
    ExportStar(FileId, StmtId),
}

/// `AliasSymbolLinks`
#[derive(Copy, Clone, Default, Debug)]
pub struct AliasSymbolLinks {
    /// What `getTargetOfAliasDeclaration` gives, which may be an alias again.
    pub immediate_target: Option<Sym>,
    /// `None`: `unknownSymbol`.
    pub alias_target: Option<Sym>,
    pub type_only_declaration: Option<TypeOnlyDeclaration>,
    /// `resolveAlias` reports 2303 at the declaration of the alias.
    pub is_circular: bool,
}

/// `typeResolutions` and `resolutionResults` of a thread, as far as they are about `TypeSystemPropertyNameAliasTarget`.
struct Resolving {
    resolutions: Vec<(Sym, bool)>,
    /// How often an alias was asked for while it was being resolved.
    circles: u32,
    /// What is under way is the same whoever asked first. Not once `tryResolveAlias` has passed over some of it.
    is_kept: bool,
}

thread_local! {
    static RESOLVING: std::cell::RefCell<Resolving> = const { std::cell::RefCell::new(Resolving { resolutions: Vec::new(), circles: 0, is_kept: true }) };
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
    // `place`: where `json` is written. What is not written is put at `end`, where the file ends.
    fn value(
        f: &mut hir::File,
        json: &Json,
        place: Option<&crate::json_places::Value>,
        end: u32,
        atoms: &Interner,
    ) -> ExprId {
        let pos = place.map_or(end, |place| place.from);
        let kind = match json {
            Json::Null => ExprKind::Null,
            Json::Bool(true) => ExprKind::True,
            Json::Bool(false) => ExprKind::False,
            // `parsePrefixUnaryExpression`
            Json::Number(n) if n.is_sign_negative() => {
                let number = f.number(-*n);
                ExprKind::Unary {
                    op: UnOp::Minus,
                    operand: f.expr(ExprKind::Number(number), (pos + 1).min(end)),
                }
            }
            Json::Number(n) => ExprKind::Number(f.number(*n)),
            Json::String(s) => ExprKind::String(atoms.intern_str(s)),
            Json::Array(items) => {
                let items: Vec<ExprId> = items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| {
                        let place = place.and_then(|place| place.element(i));
                        value(f, item, place, end, atoms)
                    })
                    .collect();
                ExprKind::Array(f.list(&items))
            }
            Json::Object(entries) => {
                let members: &[crate::json_places::Member] = match place.map(|place| &place.what) {
                    Some(crate::json_places::Written::Object(members)) => &members[..],
                    _ => &[],
                };
                let props: Vec<Prop> = entries
                    .iter()
                    .enumerate()
                    .map(|(i, (k, v))| {
                        let member = members.get(i);
                        let pos = member.map_or(end, |member| member.name_from);
                        Prop {
                            kind: PropKind::Init,
                            key: PropKey::Name(atoms.intern_str(k)),
                            value: value(f, v, member.map(|member| &member.value), end, atoms),
                            pos,
                            start: pos,
                        }
                    })
                    .collect();
                ExprKind::Object(f.add_props(&props))
            }
        };
        f.expr(kind, pos)
    }
    // The same for a file with syntax errors, as TypeScript's parser recovers from them.
    fn expression(f: &mut hir::File, e: &Expression, atoms: &Interner) -> ExprId {
        let kind = match &e.kind {
            ExpressionKind::Null => ExprKind::Null,
            ExpressionKind::Bool(true) => ExprKind::True,
            ExpressionKind::Bool(false) => ExprKind::False,
            ExpressionKind::Number(n) => ExprKind::Number(f.number(*n)),
            ExpressionKind::String(s) => ExprKind::String(atoms.intern_str(s)),
            ExpressionKind::Identifier(name) => ExprKind::Ident(atoms.intern_str(name)),
            ExpressionKind::Missing => ExprKind::Missing,
            ExpressionKind::Array(items) => {
                let items: Vec<ExprId> = items.iter().map(|i| expression(f, i, atoms)).collect();
                ExprKind::Array(f.list(&items))
            }
            ExpressionKind::Object(properties) => {
                let props: Vec<Prop> = properties
                    .iter()
                    .map(|p| {
                        let key = match &p.name {
                            PropertyName::Name(name) => PropKey::Name(atoms.intern_str(name)),
                            PropertyName::Computed(name) => match &name.kind {
                                ExpressionKind::String(name) => {
                                    PropKey::Name(atoms.intern_str(name))
                                }
                                ExpressionKind::Number(n) if !n.is_sign_negative() => {
                                    PropKey::Name(atoms.intern_str(&number_to_string(*n)))
                                }
                                _ => PropKey::Computed(expression(f, name, atoms)),
                            },
                        };
                        let (kind, value) = match (&p.initializer, key) {
                            (Some(initializer), _) => {
                                (PropKind::Init, expression(f, initializer, atoms))
                            }
                            (None, PropKey::Name(name)) => (
                                PropKind::Shorthand,
                                f.expr(ExprKind::Ident(name), p.name_pos),
                            ),
                            (None, _) => (PropKind::Init, f.expr(ExprKind::Missing, p.name_pos)),
                        };
                        Prop {
                            kind,
                            key,
                            value,
                            pos: p.name_pos,
                            start: p.name_pos,
                        }
                    })
                    .collect();
                ExprKind::Object(f.add_props(&props))
            }
        };
        f.expr(kind, e.pos)
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
            let place = crate::json_places::parse(text);
            let e = value(&mut f, &json, place.as_ref(), text.len() as u32, atoms);
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

/// `GetLibFileName`: the `N` of the `lib.N.d.ts` that has the library `lib`, which `lib_name` made. The library directory of a
/// TypeScript that has not moved the library yet has it under the name itself.
fn lib_file_stem<'a>(host: &dyn Host, options: &Options, lib: &'a str) -> &'a str {
    match crate::resolve::lib_fallback_name(lib) {
        Some(moved_to) if !host.is_file(&format!("{}/lib.{lib}.d.ts", options.lib_dir)) => moved_to,
        _ => lib,
    }
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

/// What `referenced_file` says of the file at `path`, which is `code`, in full.
fn reference_problem(options: &Options, code: u32, path: &str) -> Problem {
    if code == 6504 || code == 6053 {
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

/// `FileIncludeReason`, of a file that `checkSourceFilesBelongToPath` objects to.
#[derive(Copy, Clone)]
enum IncludeReason {
    /// `fileIncludeKindRootFile`
    RootFile,
    /// `fileIncludeKindImport` (1393) or `fileIncludeKindReferenceFile` (1400): the file that refers to it, from where to where.
    Reference {
        code: u32,
        from: FileId,
        start: u32,
        end: u32,
    },
}

/// Where the string literal that starts at `start` ends.
fn end_of_string_literal(text: &[u8], start: u32) -> u32 {
    let Some(&quote) = text.get(start as usize) else {
        return start;
    };
    let mut at = start as usize + 1;
    while let Some(&c) = text.get(at) {
        at += 1;
        match c {
            b'\\' => at += 1,
            b'\n' => return at as u32 - 1,
            _ if c == quote => break,
            _ => {}
        }
    }
    at.min(text.len()) as u32
}

/// `referenceFileLocation` of each `/// <reference path>` and each import in `module` that leads to a file of the program: that file,
/// the code of the message that says so, from where to where. In the order of `parseTask.subTasks`.
fn reference_locations(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    by_path: &FxHashMap<String, FileId>,
    module: &Module,
) -> Vec<(FileId, u32, u32, u32)> {
    let parsed;
    let hir = if module.is_dropped || module.is_transient {
        parsed = host.parse(&module.path, &module.hir.text, atoms, options);
        &parsed
    } else {
        &module.hir
    };
    let text: &[u8] = &module.hir.text;
    let mut locations = Vec::new();
    for &(kind, value, pos, _) in hir.references.iter() {
        if matches!(kind, ReferenceKind::Path)
            && !options.no_resolve
            && let Ok(found) = referenced_file(
                host,
                options,
                &referenced_path(&atoms.text(value), &module.path),
                &module.path,
            )
            && let Some(&target) = by_path.get(&found)
        {
            let end = pos + atoms.bytes(value).len() as u32;
            locations.push((target, 1400, pos, end));
        }
    }
    // `file.Imports()`: the specifiers of statements, then those of `import()`, the call and the type.
    let mut uses = hir.specifier_uses.clone();
    uses.sort_by_key(|u| u.pos);
    let mut dynamic = Vec::new();
    for u in &uses {
        let mode = if u.mode != ResolutionMode::None {
            u.mode
        } else if u.kind == SpecifierKind::Require {
            ResolutionMode::Require
        } else {
            module.default_mode
        };
        let Some(&target) = module.imports.get(&(u.spec, mode)) else {
            continue;
        };
        let location = (target, 1393, u.pos, end_of_string_literal(text, u.pos));
        let before = text
            .get(..u.pos as usize)
            .unwrap_or_default()
            .trim_ascii_end();
        if u.kind == SpecifierKind::Import && before.ends_with(b"(") {
            dynamic.push(location);
        } else {
            locations.push(location);
        }
    }
    let call_mode = options.import_call_mode(module.default_mode);
    for e in hir.exprs.iter() {
        if let ExprKind::ImportCall(argument, _) = e.kind
            && let ExprKind::String(spec) = hir[argument].kind
            && let Some(&target) = module.imports.get(&(spec, call_mode))
        {
            let pos = hir[argument].pos;
            dynamic.push((target, 1393, pos, end_of_string_literal(text, pos)));
        }
    }
    dynamic.sort_by_key(|location| location.2);
    locations.extend(dynamic);
    locations
}

/// `computeDiagnostic` of `fileIncludeKindRootFile`: the code and the arguments of what says why the root file at `path` is one.
fn root_file_reason(options: &Options, path: &str, is_case_sensitive: bool) -> (u32, Vec<String>) {
    if options.config_path.is_empty() {
        return (1427, Vec::new());
    }
    if options
        .file_specs
        .iter()
        .any(|spec| is_same_name(spec, path, is_case_sensitive))
    {
        return (1409, Vec::new());
    }
    if options.is_default_include_spec {
        return (1457, Vec::new());
    }
    match crate::config::matched_include_spec(
        &options.include_specs,
        &options.base_dir,
        path,
        is_case_sensitive,
    ) {
        Some(spec) => (1407, vec![spec.to_owned(), options.config_path.clone()]),
        None => (1427, Vec::new()),
    }
}

/// `explainRedirectAndImpliedFormat`: the code and the arguments of what says why `module` is emitted as the kind of module it is.
fn implied_format_reason(
    resolver: &Resolver,
    options: &Options,
    module: &Module,
) -> Option<(u32, Vec<String>)> {
    if !module.is_module() {
        return None;
    }
    // `loadSourceFileMetaData`
    let mut dir = parent_dir(&module.path);
    let scope = loop {
        if let Some(json) = resolver.package_json(dir) {
            break Some((join(dir, "package.json"), json));
        }
        if dir.is_empty() || dir == "/" {
            break None;
        }
        dir = parent_dir(dir);
    };
    let is_type_recorded = options.resolves_like_node
        && ![".mts", ".cts", ".mjs", ".cjs"]
            .iter()
            .any(|e| module.path.ends_with(e))
        || module.path.contains("/node_modules/");
    let package_type = scope
        .as_ref()
        .filter(|_| is_type_recorded)
        .and_then(|scope| scope.1.get("type"))
        .and_then(Json::as_str)
        .unwrap_or("");
    let package_json = scope.as_ref().map(|scope| scope.0.clone());
    match (module.implied_format, package_json) {
        (ResolutionMode::Import, Some(path)) if package_type == "module" => {
            Some((1458, vec![path]))
        }
        (ResolutionMode::Require, Some(path)) if !package_type.is_empty() => {
            Some((1459, vec![path]))
        }
        (ResolutionMode::Require, Some(path)) => Some((1460, vec![path])),
        (ResolutionMode::Require, None) => Some((1461, Vec::new())),
        _ => None,
    }
}

/// `sourceFileMayBeEmitted`. `GetProjectReferenceFromSource` is asked in `explain_source_files`.
fn source_file_may_be_emitted(options: &Options, module: &Module, is_case_sensitive: bool) -> bool {
    if module.is_lib || module.hir.kind == FileKind::Declaration || module.is_from_external_library
    {
        return false;
    }
    // `GetCommonSourceDirectory`, if `rootDir` or the configuration file says it.
    let common = match options.root_dir.as_str() {
        "" => parent_dir(&options.config_path),
        root_dir => root_dir,
    };
    // `GetSourceFilePathInNewDirWorker`: a JSON file that is not under there would be written over itself.
    module.hir.kind != FileKind::Json
        || !options.out_dir.is_empty()
            && (common.is_empty()
                || is_path_under(common, &module.path, is_case_sensitive)
                    && !is_same_name(&options.out_dir, common, is_case_sensitive))
}

/// `createDiagnosticExplainingFile`: `code`, said of the file and `arg`, for each source file that would be emitted and that `is_wrong`
/// holds for, which is told whether it is a root file. With it the first import or `/// <reference path>` that brings the file into
/// the program (`preferredLocation`: the file, from where to where), which is where it is reported.
#[allow(clippy::too_many_arguments)]
fn explain_source_files(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    modules: &[ModuleCell],
    by_path: &FxHashMap<String, FileId>,
    roots: &[String],
    starts: &[FileId],
    code: u32,
    arg: &str,
    is_wrong: &dyn Fn(&Module, bool) -> bool,
) -> Vec<(Option<(FileId, u32, u32)>, Problem)> {
    let is_case_sensitive = host.is_case_sensitive();
    let mut is_root = vec![false; modules.len()];
    for root in roots {
        if let Some(&id) = by_path.get(root) {
            is_root[id.idx()] = true;
        }
    }
    let mut is_reported: Vec<bool> = modules
        .iter()
        .zip(&is_root)
        .map(|(module, &is_root)| {
            let module: &Module = module;
            source_file_may_be_emitted(options, module, is_case_sensitive)
                && is_wrong(module, is_root)
        })
        .collect();
    if !is_reported.contains(&true) {
        return Vec::new();
    }
    for (i, reported) in is_reported.iter_mut().enumerate() {
        // `GetProjectReferenceFromSource`: which files belong to a referenced project is not known here.
        *reported &= is_root[i] || !options.has_project_references;
    }
    if !is_reported.contains(&true) {
        return Vec::new();
    }
    // `collectFiles`: the reason of a sub task is added before the walk goes into it.
    let mut reasons: Vec<Vec<IncludeReason>> = vec![Vec::new(); modules.len()];
    let mut locations: FxHashMap<FileId, Vec<(FileId, u32, u32, u32)>> = FxHashMap::default();
    let mut seen = vec![false; modules.len()];
    for &first in starts {
        if is_reported[first.idx()] && is_root[first.idx()] {
            reasons[first.idx()].push(IncludeReason::RootFile);
        }
        // (file, how many of its edges have been followed)
        let mut stack: Vec<(FileId, usize)> = Vec::new();
        if !std::mem::replace(&mut seen[first.idx()], true) {
            stack.push((first, 0));
        }
        while let Some(top) = stack.last_mut() {
            let (file, next) = *top;
            let edges = &modules[file.idx()].edges;
            let Some(&edge) = edges.get(next) else {
                stack.pop();
                continue;
            };
            top.1 += 1;
            if is_reported[edge.idx()] && !edges[..next].contains(&edge) {
                let found = locations.entry(file).or_insert_with(|| {
                    reference_locations(host, options, atoms, by_path, &modules[file.idx()])
                });
                reasons[edge.idx()].extend(found.iter().filter(|location| location.0 == edge).map(
                    |&(_, code, start, end)| IncludeReason::Reference {
                        code,
                        from: file,
                        start,
                        end,
                    },
                ));
            }
            if !std::mem::replace(&mut seen[edge.idx()], true) {
                stack.push((edge, 0));
            }
        }
    }
    let resolver = Resolver::new(host, options);
    let mut problems = Vec::new();
    for (i, module) in modules.iter().enumerate() {
        let reasons = &reasons[i];
        if !is_reported[i] || reasons.is_empty() {
            continue;
        }
        let preferred_location = reasons.iter().find_map(|reason| match *reason {
            IncludeReason::Reference {
                from, start, end, ..
            } => Some((from, start, end)),
            IncludeReason::RootFile => None,
        });
        let mut problem = Problem::new(code, &[module.path.as_str(), arg], Place::Nowhere);
        if preferred_location.is_none() || reasons.len() != 1 {
            problem = problem.with(1, 1430, &[]);
            for reason in reasons {
                problem = match *reason {
                    IncludeReason::RootFile => {
                        let (code, args) =
                            root_file_reason(options, &module.path, is_case_sensitive);
                        let args: Vec<&str> = args.iter().map(String::as_str).collect();
                        problem.with(2, code, &args)
                    }
                    IncludeReason::Reference {
                        code,
                        from,
                        start,
                        end,
                    } => {
                        let from = &modules[from.idx()];
                        let written = from
                            .hir
                            .text
                            .get(start as usize..end as usize)
                            .unwrap_or_default();
                        let written = String::from_utf8_lossy(written);
                        problem.with(2, code, &[&*written, from.path.as_str()])
                    }
                };
            }
        }
        if let Some((code, args)) = implied_format_reason(&resolver, options, module) {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            problem = problem.with(1, code, &args);
        }
        problems.push((preferred_location, problem));
    }
    problems
}

/// The parts of `verifyCompilerOptions` that go by what is emitted and where. 6307 for a source file that a composite project does not
/// list, 6059 (`checkSourceFilesBelongToPath`) for one that is not under `rootDir`, 5009 and 5011 for what the sources have in
/// common, and `verifyEmitFilePath`: 5055 for an output file
/// that is an input file, 5056 for one that two input files are written to. What is reported at a place in a file goes to
/// `include_errors`.
#[allow(clippy::too_many_arguments)]
fn output_path_errors(
    host: &dyn Host,
    options: &Options,
    atoms: &Interner,
    modules: &[ModuleCell],
    by_path: &FxHashMap<String, FileId>,
    roots: &[String],
    starts: &[FileId],
    include_errors: &mut Vec<(FileId, u32, u32, Problem)>,
) -> Vec<Problem> {
    let mut errors = Vec::new();
    let is_case_sensitive = host.is_case_sensitive();
    let declaration_dir = if options.writes_declarations {
        options.declaration_dir.as_str()
    } else {
        ""
    };
    let sources: Vec<&Module> = modules
        .iter()
        .map(|module| &**module)
        .filter(|module| source_file_may_be_emitted(options, module, is_case_sensitive))
        .collect();
    let paths: Vec<&str> = sources.iter().map(|module| module.path.as_str()).collect();
    let explain = |code: u32, arg: &str, is_wrong: &dyn Fn(&Module, bool) -> bool| {
        explain_source_files(
            host, options, atoms, modules, by_path, roots, starts, code, arg, is_wrong,
        )
    };
    let mut explained = Vec::new();
    if options.composite {
        explained = explain(6307, options.config_path.as_str(), &|_, is_root| !is_root);
    }
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
            explained.extend(explain(6059, said, &|module, _| {
                !is_path_under(said, &module.path, is_case_sensitive)
            }));
            common = Some(said.to_owned());
        }
        if common.is_none() && !options.out_dir.is_empty() {
            errors.push(Problem::new(5009, &[], Place::Key("outDir", "")));
        }
    }
    for (at, problem) in explained {
        match at {
            Some((file, start, end)) => include_errors.push((file, start, end, problem)),
            None => errors.push(problem),
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
    if flags.contains(SymFlags::PROPERTY) {
        out |= value.difference(SymFlags::PROPERTY);
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
            let lib = lib_file_stem(host, &options, lib);
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
            // `addRootFileTask`
            match referenced_file(host, &options, root, "") {
                Ok(found) => starts.push(add(
                    found,
                    false,
                    0,
                    &mut modules,
                    &mut depths,
                    &mut frontier,
                )),
                Err(code) => {
                    let (reason, args) = root_file_reason(&options, root, host.is_case_sensitive());
                    let args: Vec<&str> = args.iter().map(String::as_str).collect();
                    let problem = reference_problem(&options, code, root);
                    program_errors.push(problem.with(1, 1430, &[]).with(2, reason, &args));
                }
            }
        }
        for name in &automatic_type_directives(host, &options) {
            match resolver.resolve_type_reference(
                name,
                &options.base_dir,
                ResolutionMode::None,
                true,
            ) {
                Some((path, is_external)) => {
                    let depth = u32::from(is_external);
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
        // The sub tasks: from which file to which, and `increaseDepth`.
        let mut steps: Vec<(FileId, FileId, bool)> = Vec::new();
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
            let _linking = Spent::on(host, Phase::Link);
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
                    steps.push((*id, target, increases_depth));
                }
                for (spec, mode, path, brings_in, increases_depth) in loaded.imports {
                    let depth = depth + u32::from(increases_depth);
                    // `elideOnDepth`, `isJsFileFromNodeModules`: JavaScript deeper inside packages than `maxNodeModuleJsDepth` is not loaded.
                    let is_elided = increases_depth
                        && is_javascript(&path)
                        && path.contains("/node_modules/")
                        && depth > options.max_node_module_js_depth;
                    // `shouldAddFile`: with `noResolve` nothing does.
                    if !brings_in || is_elided || options.no_resolve {
                        only_found.push((*id, spec, mode, path));
                        continue;
                    }
                    let target = add(path, false, depth, &mut modules, &mut depths, &mut frontier);
                    loaded.module.imports.insert((spec, mode), target);
                    loaded.module.edges.push(target);
                    steps.push((*id, target, increases_depth));
                }
                modules[id.idx()] = Some(loaded.module);
            }
        }
        // `lowestDepth`: the least over all ways to a file. ("If we're seeing this task at a lower depth than before, reprocess its
        // subtasks": `filesParser.start` of 7.0.2 starts them once, so there it depends on which thread came first.)
        loop {
            let mut is_lower = false;
            for &(from, to, increases_depth) in &steps {
                let depth = depths[from.idx()] + u32::from(increases_depth);
                is_lower |= depth < depths[to.idx()];
                depths[to.idx()] = depths[to.idx()].min(depth);
            }
            if !is_lower {
                break;
            }
        }
        for (module, &depth) in modules.iter_mut().flatten().zip(&depths) {
            module.is_from_external_library = depth > 0;
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
        let mut package_jsons: FxHashMap<String, Json> = FxHashMap::default();
        if options.emits_declaration_files {
            for module in modules.iter().flatten() {
                if let Some((_, _, end)) = crate::resolve::node_module_path_parts(&module.path)
                    && !package_jsons.contains_key(&module.path[..end])
                    && let Some(json) = resolver.package_json(&module.path[..end])
                {
                    package_jsons.insert(module.path[..end].to_owned(), json);
                }
            }
        }
        let mut linked_directories = Vec::new();
        if options.emits_declaration_files {
            // `SourceFileMayBeEmitted`
            let emitted = modules.iter().flatten().filter(|module| {
                matches!(module.hir.kind, hir::FileKind::Ts | hir::FileKind::Tsx)
                    && !module.is_lib
                    && !module.path.contains("/node_modules/")
            });
            linked_directories =
                resolver.linked_directories(emitted.map(|module| module.path.as_str()));
            for (_, link) in &linked_directories {
                if !package_jsons.contains_key(link)
                    && let Some(json) = resolver.package_json(link)
                {
                    package_jsons.insert(link.clone(), json);
                }
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
        let mut include_errors = Vec::new();
        program_errors.extend(output_path_errors(
            host,
            &options,
            &atoms,
            &modules,
            &by_path,
            roots,
            &starts,
            &mut include_errors,
        ));
        let has_type_only_stars = modules.iter().any(|m| {
            m.bound.export_stars.iter().any(|&(_, star)| {
                matches!(
                    m.hir[star].kind,
                    StmtKind::ExportStar {
                        type_only: true,
                        ..
                    }
                )
            })
        });
        let symbols = Bases::new(modules.iter().map(|m| m.bound.symbols.len()));
        let memo = Memo::new(&Bases::new(modules.iter().map(|_| 0)));
        let mut files = Files {
            atoms,
            options,
            modules,
            by_path,
            globals: FxHashMap::default(),
            global_this_symbol: Sym {
                file: FileId(0),
                id: SymbolId::NONE,
            },
            ambient_modules: FxHashMap::default(),
            ambient_patterns: Vec::new(),
            pattern_augmentations: FxHashMap::default(),
            merged_symbols: FxHashMap::default(),
            merged_parts: FxHashMap::default(),
            every_part: FxHashMap::default(),
            stand_ins: Vec::new(),
            merged_exports: FxHashMap::default(),
            sorted_exports: FxHashMap::default(),
            merged_members: Vec::new(),
            merged_member: FxHashMap::default(),
            refused_merges: Vec::new(),
            circular_at_merge: Vec::new(),
            has_type_only_stars,
            alias_symbol_links: ByNodeKept::new(&symbols),
            is_merged: false,
            memo,
            order: Vec::new(),
            ranks: Vec::new(),
            program_errors,
            include_errors,
            package_jsons,
            linked_directories,
        };
        let _merging = Spent::on(host, Phase::Merge);
        files.order = files.declaration_order(&starts);
        files.ranks = vec![u32::MAX; files.modules.len()];
        for (rank, &file) in files.order.iter().enumerate() {
            files.ranks[file.idx()] = rank as u32;
        }
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
                                .filter(|(_, _, path, brings_in, _)| {
                                    *brings_in
                                        && !options.no_resolve
                                        && !(is_javascript(path) && path.contains("/node_modules/"))
                                })
                                .map(|(_, _, path, ..)| (path, false)),
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
        // The default library is not looked into for how it is written.
        if !is_lib {
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
        let _binding = Spent::on(host, Phase::Bind);
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
        let _resolving = Spent::on(host, Phase::Resolve);
        let mut imports = Vec::new();
        let (mut untyped_imports, mut jsx_imports, mut untyped_package_imports) =
            (Vec::new(), Vec::new(), Vec::new());
        let mut untyped_import_files = Vec::new();
        let mut untyped_import_alternates = Vec::new();
        let mut ts_extension_imports = Vec::new();
        let mut project_reference_imports = Vec::new();
        let mut arbitrary_extension_imports = Vec::new();
        let mut arbitrary_extension_files = Vec::new();
        let mut extensionless_imports = Vec::new();
        // `resolveImportsAndModuleAugmentations`: with `importHelpers`, a file that can be emitted with helpers imports `tslib`.
        if options.import_helpers
            && (hir.is_js
                || hir.kind != FileKind::Declaration
                    && (options.isolated_modules || hir.has_module_syntax))
            && let Some(resolved) = resolver.resolve_module_name("tslib", path, default_mode)
        {
            let found = resolved.file_name;
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
                let increases_depth = resolved.is_external_library_import;
                imports.push((tslib, default_mode, found, true, increases_depth));
            }
        }
        // Only a file that can have tags in it, going by its name, imports what they are made with.
        if (path.ends_with(".tsx") || path.ends_with(".jsx"))
            && let Some(runtime) = jsx_runtime_of(options, &hir, atoms)
            && let Some(resolved) = resolver.resolve_module_name(&runtime, path, default_mode)
        {
            let found = resolved.file_name;
            let spec = atoms.intern_str(&runtime);
            let is_untyped = is_javascript(&found);
            if is_untyped {
                untyped_imports.push((spec, default_mode));
                if let Some(types) = resolved.alternate_result {
                    let types = atoms.intern(types.as_bytes());
                    untyped_import_alternates.push((spec, default_mode, types));
                }
                let package = resolver.package_id(&found);
                untyped_import_files.push((
                    atoms.intern(found.as_bytes()),
                    package
                        .as_deref()
                        .and_then(|id| Some(&id[..1 + id.get(1..)?.find('@')?]))
                        .map(|name| atoms.intern(name.as_bytes())),
                ));
                if found.contains("/node_modules/") {
                    untyped_package_imports.push((spec, default_mode));
                }
            }
            if !is_untyped || options.allow_js {
                let increases_depth = resolved.is_external_library_import;
                imports.push((spec, default_mode, found, true, increases_depth));
            }
        }
        // The arguments of `import()` calls, and of `require()` calls in JavaScript (`ForEachDynamicImportOrRequireCall`).
        let (mut called, mut required): (Vec<Atom>, Vec<Atom>) = (Vec::new(), Vec::new());
        if !bound.specifiers.is_empty() {
            for (i, e) in hir.exprs.iter().enumerate() {
                if matches!(bound.expr_parent[i], bind::Parent::None) {
                    continue;
                }
                match e.kind {
                    ExprKind::ImportCall(argument, _) => {
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
        for &spec in ambient
            .chain(&bound.specifiers)
            .chain(bound.module_augmentations.iter())
        {
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
                let Some(resolved) = resolver.resolve_module_name(&text, path, mode) else {
                    continue;
                };
                let increases_depth = resolved.is_external_library_import;
                match resolved.file_name {
                    found if is_javascript(&found) => {
                        untyped_imports.push((spec, mode));
                        if let Some(types) = resolved.alternate_result {
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
                        let needs_jsx = options.jsx == JsxEmit::None && found.ends_with(".jsx");
                        if needs_jsx {
                            jsx_imports.push((spec, mode, atoms.intern(found.as_bytes())));
                        }
                        if found.contains("/node_modules/") {
                            untyped_package_imports.push((spec, mode));
                        }
                        // `shouldAddFile`: with `allowJs`, JavaScript is loaded like any other file. `Files::load` skips files too deep
                        // inside packages. A file that is not loaded for this import is still linked if it is in the program for
                        // another reason.
                        if options.allow_js {
                            let brings_in = !needs_jsx && (i < imported || !is_module_name);
                            imports.push((spec, mode, found, brings_in, increases_depth));
                        }
                    }
                    // `needAllowArbitraryExtensions`: the file is refused, even if it is in the program for another reason.
                    found
                        if resolved.has_arbitrary_extension
                            && hir.kind != FileKind::Declaration
                            && !options.allow_arbitrary_extensions =>
                    {
                        arbitrary_extension_imports.push((spec, mode));
                        arbitrary_extension_files.push(atoms.intern(found.as_bytes()));
                    }
                    found => {
                        if resolved.using_ts_extension {
                            ts_extension_imports.push((spec, mode));
                        }
                        let is_redirect = resolved.is_project_reference_redirect;
                        if is_redirect {
                            project_reference_imports.push((spec, mode));
                        }
                        let needs_jsx =
                            options.jsx == JsxEmit::None && !is_redirect && found.ends_with(".tsx");
                        if needs_jsx {
                            jsx_imports.push((spec, mode, atoms.intern(found.as_bytes())));
                        }
                        let brings_in = !needs_jsx && (i < imported || !is_module_name);
                        imports.push((spec, mode, found, brings_in, increases_depth));
                    }
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
                    let name = lib_file_stem(host, options, &name);
                    // `GetLibFileName`: whether there is such a library does not depend on what stands in for it.
                    if host.is_file(&format!("{}/lib.{name}.d.ts", options.lib_dir)) {
                        let (found, is_lib) = lib_path(resolver, options, name);
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
                        Some((found, is_external)) => types.push((found, false, is_external)),
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
            project_reference_imports: project_reference_imports.into(),
            is_from_external_library: false,
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

    /// `GetIncludeProcessorDiagnostics`: what is wrong with a file being in the program, reported at a place in `file` that refers to
    /// it. The second and the third are from where to where.
    pub fn include_problems_in(
        &self,
        file: FileId,
    ) -> impl Iterator<Item = &(FileId, u32, u32, Problem)> {
        self.include_errors
            .iter()
            .filter(move |problem| problem.0 == file)
    }

    /// The module `file` imports for its JSX without saying so.
    pub fn jsx_runtime(&self, file: FileId) -> Option<Atom> {
        let module = &self.modules[file.idx()];
        // `resolveImportsAndModuleAugmentations`: only `ScriptKindTSX` and `ScriptKindJSX` import it.
        if !module.path.ends_with(".tsx") && !module.path.ends_with(".jsx") {
            return None;
        }
        let runtime = jsx_runtime_of(&self.options, &module.hir, &self.atoms)?;
        self.atoms.lookup(runtime.as_bytes())
    }

    // ───────────────────────────── merging ─────────────────────────────

    /// `fileIndexMap`: where `file` is among the files of the program, which `compareNodes` goes by.
    #[inline]
    pub fn rank_of_file(&self, file: FileId) -> u32 {
        self.ranks[file.idx()]
    }

    /// `getDefaultLibFilePriority`
    fn default_lib_file_priority(&self, file: FileId) -> usize {
        let path = self.modules[file.idx()].path.as_str();
        let is_in_lib_dir = path
            .strip_prefix(self.options.lib_dir.trim_end_matches('/'))
            .is_some_and(|rest| rest.starts_with('/'));
        if is_in_lib_dir {
            let basename = &path[path.rfind('/').map_or(0, |slash| slash + 1)..];
            if basename == "lib.d.ts" || basename == "lib.es6.d.ts" {
                return 0;
            }
            let name = basename.strip_prefix("lib.").unwrap_or(basename);
            let name = name.strip_suffix(".d.ts").unwrap_or(name);
            if let Some(index) = crate::resolve::LIB_NAMES
                .split(' ')
                .position(|lib| lib == name)
            {
                return index + 1;
            }
        }
        crate::resolve::LIB_NAMES.split(' ').count() + 2
    }

    /// `getProcessedFiles`: the libraries first, sorted (`sortLibs`); then from each starting point depth first, a file after
    /// everything it refers to.
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
        libs.sort_by_cached_key(|&file| self.default_lib_file_priority(file));
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
                    Some(existing) => self.merge_symbol(existing, sym, false),
                    None => self.get_merged_symbol(sym),
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
                let merged = match self.ambient_modules.get(&name).copied() {
                    Some(existing) => self.merge_symbol(existing, sym, false),
                    None => sym,
                };
                self.ambient_modules.insert(name, merged);
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
                    if self.ambient_patterns.iter().any(|p| p.2 == target) {
                        let merged = self.merge_symbol(sym, target, true);
                        self.pattern_augmentations.insert(name, merged);
                        continue;
                    }
                    // What the module only passes on with `export *` is added to where it is declared.
                    for (name, addition) in self.exports_in_table(sym) {
                        if self.export(target, name).is_none()
                            && let Some(found) = self.module_export(target, name)
                            && let Some(resolved) = self.resolve_alias_if_needed(found)
                        {
                            // `mergeSymbol`: what cannot be one symbol stays two, and the module has the addition under the name.
                            if self
                                .flags(resolved)
                                .intersects(excluded_flags(self.flags(addition)))
                            {
                                let resolved = self.canonical(resolved);
                                self.refused_merges.push((resolved, addition));
                                continue;
                            }
                            self.merge_symbol(found, addition, false);
                        }
                    }
                    self.merge_symbol(target, sym, false);
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
        self.make_global_this_symbol();
        // What an alias was found to stand for while symbols were being put together may be a part of something by now.
        let symbols = Bases::new(self.modules.iter().map(|m| m.bound.symbols.len()));
        self.alias_symbol_links = ByNodeKept::new(&symbols);
        // Their `aliasTarget` stays `unknownSymbol`, even if the merge broke the circle.
        for &alias in &self.circular_at_merge {
            let links = AliasSymbolLinks {
                is_circular: true,
                ..AliasSymbolLinks::default()
            };
            self.alias_symbol_links.insert_ref(alias, links);
        }
        self.memo = Memo::new(&symbols);
        for &part in self.merged_symbols.keys() {
            self.memo.whole.insert(part, Some(self.canonical(part)));
        }
        for &whole in self.merged_parts.keys() {
            self.memo.whole.insert(whole, Some(whole));
        }
        self.sorted_exports = self
            .merged_exports
            .iter()
            .map(|(&sym, table)| {
                let mut all: Vec<(Atom, Sym)> = table
                    .iter()
                    .map(|(&n, &s)| (n, self.canonical(s)))
                    .collect();
                all.sort_unstable();
                (sym, all.into_boxed_slice())
            })
            .collect();
        self.merge_members();
        self.is_merged = true;
    }

    /// `mergeSymbolTable`, of `Members` and `Exports` of the classes and interfaces that are made of several parts: a member of one
    /// part is one symbol with the member of that name of the parts before, unless `getExcludedSymbolFlags` says otherwise.
    fn merge_members(&mut self) {
        let (mut merged_members, mut merged_member) = (Vec::new(), FxHashMap::default());
        // What the parts have in their tables: the name, which part, `includes`, and the first declaration of the symbol.
        let mut declared: Vec<(MemberKey, usize, u8, MemberDeclaration)> = Vec::new();
        for (&whole, parts) in &self.merged_parts {
            if !self
                .flags(whole)
                .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            {
                continue;
            }
            declared.clear();
            for (index, &part) in parts.iter().enumerate() {
                let (hir, bound) = (self.hir(part.file), self.bound(part.file));
                for &decl in &bound.symbols[part.id.idx()].decls {
                    let owner = match decl {
                        Decl::Class(class) if bound.class_symbol[class.idx()] == part.id => {
                            MemberOwner::Class(class)
                        }
                        Decl::Interface(interface)
                            if bound.interface_symbol[interface.idx()] == part.id =>
                        {
                            MemberOwner::Interface(interface)
                        }
                        _ => continue,
                    };
                    bound.for_each_declared_member(
                        hir,
                        owner,
                        |(key, declaration, includes, _)| {
                            if let Some(declaration) = declaration
                                && !bound.is_member_in_no_table(declaration)
                                && let Some(&first) =
                                    bound.declarations_of_member(&declaration).first()
                            {
                                declared.push((key, index, includes, first));
                            }
                        },
                    );
                }
            }
            declared.sort_by_key(|member| (member.0, member.1));
            for of_name in declared.chunk_by(|a, b| a.0 == b.0) {
                let (mut flags, mut declarations, mut firsts) = (0, Vec::new(), Vec::new());
                for of_part in of_name.chunk_by(|a, b| a.1 == b.1) {
                    let source = of_part.iter().fold(0, |flags, member| flags | member.2);
                    // `reportMergeSymbolError`: it stays a symbol of its own.
                    if flags & member_flags::excluded(source) != 0 {
                        continue;
                    }
                    flags |= source;
                    let (file, first) = (parts[of_part[0].1].file, of_part[0].3);
                    let own = self.bound(file).declarations_of_member(&first);
                    declarations.extend(own.iter().map(|&declaration| (file, declaration)));
                    firsts.push((file, first));
                }
                if firsts.len() > 1 {
                    let index = merged_members.len() as u32;
                    merged_member.extend(firsts.into_iter().map(|first| (first, index)));
                    merged_members.push(declarations.into_boxed_slice());
                }
            }
        }
        (self.merged_members, self.merged_member) = (merged_members, merged_member);
    }

    /// `symbol.Declarations` of `declaration.Symbol`, which is a member or a type parameter of a class, an interface or a type
    /// literal in `file`.
    pub fn declarations_of_member(
        &self,
        file: FileId,
        declaration: MemberDeclaration,
    ) -> List<'_, (FileId, MemberDeclaration)> {
        let own = self.bound(file).declarations_of_member(&declaration);
        match own
            .first()
            .and_then(|&first| self.merged_member.get(&(file, first)))
        {
            Some(&index) => List::Kept(&self.merged_members[index as usize]),
            None if own.len() == 1 => List::One((file, declaration)),
            None => List::Own(own.iter().map(|&declaration| (file, declaration)).collect()),
        }
    }

    fn symbol_mut(&mut self, sym: Sym) -> &mut Symbol {
        &mut self.modules[sym.file.idx()].bound.symbols[sym.id.idx()]
    }

    /// `c.globalThisSymbol = c.newSymbolEx(ast.SymbolFlagsModule, "globalThis", ..)`, `c.globalThisSymbol.Exports = c.globals`
    fn make_global_this_symbol(&mut self) {
        if self.modules.is_empty() {
            return;
        }
        let symbols = &mut self.modules[0].bound.symbols;
        let global_this = Sym {
            file: FileId(0),
            id: SymbolId(symbols.len() as u32),
        };
        symbols.push(Symbol {
            name: known::globalThis,
            flags: SymFlags::MODULE | SymFlags::MERGED | SymFlags::TRANSIENT,
            decls: bind::Decls::Many(Box::default()),
            parent: SymbolId::NONE,
            exports: bind::TableId::NONE,
            export_symbol: SymbolId::NONE,
        });
        self.globals.insert(known::globalThis, global_this);
        self.merged_exports
            .insert(global_this, self.globals.clone());
        self.global_this_symbol = global_this;
    }

    /// `getMergedSymbol`
    fn get_merged_symbol(&self, sym: Sym) -> Sym {
        self.merged_symbols.get(&sym).copied().unwrap_or(sym)
    }

    /// `recordMergedSymbol`
    fn record_merged_symbol(&mut self, target: Sym, source: Sym) {
        self.symbol_mut(source).flags |= SymFlags::MERGED;
        self.merged_symbols.insert(source, target);
    }

    /// `cloneSymbol`. The clone is a symbol of the file of `symbol`, where `decls`, `parent` and `exports` mean what they mean for
    /// `symbol`. It takes over what the tables have for `symbol`: from now on `canonical` leads past that.
    fn clone_symbol(&mut self, symbol: Sym) -> Sym {
        let parts = self.merged_parts.remove(&symbol);
        let every_part = self.every_part.remove(&symbol);
        let exports = self.merged_exports.remove(&symbol);
        let symbols = &mut self.modules[symbol.file.idx()].bound.symbols;
        let cloned = &symbols[symbol.id.idx()];
        let clone = Symbol {
            name: cloned.name,
            flags: cloned.flags | SymFlags::MERGED | SymFlags::TRANSIENT,
            decls: bind::Decls::Many(cloned.decls.as_slice().into()),
            parent: cloned.parent,
            exports: cloned.exports,
            export_symbol: cloned.export_symbol,
        };
        let result = Sym {
            file: symbol.file,
            id: SymbolId(symbols.len() as u32),
        };
        symbols.push(clone);
        self.merged_parts
            .insert(result, parts.unwrap_or_else(|| vec![symbol]));
        self.every_part
            .insert(result, every_part.unwrap_or_else(|| vec![symbol]));
        if let Some(exports) = exports {
            self.merged_exports.insert(result, exports);
        }
        self.record_merged_symbol(result, symbol);
        result
    }

    /// `symbol.Exports`, sorted by name.
    fn exports_in_table(&self, sym: Sym) -> Vec<(Atom, Sym)> {
        let mut all: Vec<(Atom, Sym)> = match self.merged_exports.get(&sym) {
            Some(table) => table.iter().map(|(&n, &s)| (n, s)).collect(),
            None => {
                let (file, bound) = (sym.file, self.bound(sym.file));
                bound
                    .table(bound.symbols[sym.id.idx()].exports)
                    .iter()
                    .map(|&(n, id)| (n, Sym { file, id }))
                    .collect()
            }
        };
        all.sort_unstable();
        all
    }

    /// `mergeSymbol`. The answer is what the table that has `target` has from then on.
    fn merge_symbol(&mut self, mut target: Sym, source: Sym, unidirectional: bool) -> Sym {
        // `mergeModuleAugmentation`: the one symbol of several augmentations in a file is merged once.
        if source == target || self.get_merged_symbol(source) == target {
            return target;
        }
        let (target_flags, source_flags) = (self.flags(target), self.flags(source));
        // `IsNonLocalAlias`
        let meanings = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let is_alias = target_flags.contains(SymFlags::ALIAS) && !target_flags.intersects(meanings);
        // `reportMergeSymbolError`. "Assignment declarations are allowed to merge with variables, no matter what other flags they have."
        if target_flags.intersects(excluded_flags(source_flags))
            && !(source_flags | target_flags).contains(SymFlags::ASSIGNMENT)
        {
            // Two aliases are never one: the first keeps the name.
            if is_alias || unidirectional {
                self.refused_merges.push((target, source));
                return target;
            }
            // What cannot be one symbol with what has the name adds nothing to it: two classes, a class and a variable. It stays what
            // its own declarations are about, and the name goes on meaning the first wherever it is used.
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
        if !target_flags.contains(SymFlags::TRANSIENT) {
            // `resolveSymbol`: what is added to a name that only stands for something is added to what it stands for.
            let mut resolved = target;
            if is_alias {
                match self.resolve_alias_as(target, meanings) {
                    Some(found) if found == source => return source,
                    // Where the two cannot be one, the addition has the name.
                    Some(found) if self.flags(found).intersects(excluded_flags(source_flags)) => {
                        self.refused_merges.push((target, source));
                        return source;
                    }
                    Some(found) => resolved = found,
                    // It may be a property of what a module `export =`s, which only the type of that tells. The alias goes on standing
                    // for it.
                    None if self.may_be_property_of_export_equals(target) => {}
                    // Where the alias leads nowhere (`unknownSymbol`), the addition has the name as well.
                    None => {
                        self.keep_circular_aliases(target);
                        return source;
                    }
                }
            }
            target = self.clone_symbol(resolved);
        }
        self.symbol_mut(target).flags |= source_flags;
        let (parts, every_part) = (
            self.parts(source).into_vec(),
            self.every_part(source).into_vec(),
        );
        self.merged_parts.entry(target).or_default().extend(parts);
        self.every_part
            .entry(target)
            .or_default()
            .extend(every_part);
        let source_exports = self.exports_in_table(source);
        if !source_exports.is_empty() || self.symbol(target).exports.is_some() {
            if !self.merged_exports.contains_key(&target) {
                let table = self.exports_in_table(target).into_iter().collect();
                self.merged_exports.insert(target, table);
            }
            // `mergeSymbolTable`
            for (name, source_symbol) in source_exports {
                let merged = match self.merged_exports[&target].get(&name).copied() {
                    Some(existing) => self.merge_symbol(existing, source_symbol, unidirectional),
                    None => self.get_merged_symbol(source_symbol),
                };
                if let Some(table) = self.merged_exports.get_mut(&target) {
                    table.insert(name, merged);
                }
            }
        }
        if !unidirectional {
            self.record_merged_symbol(target, source);
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
            export_symbol: SymbolId::NONE,
        });
        self.stand_ins.push((refused, stand_in));
        self.merged_symbols.insert(
            Sym {
                file: refused.file,
                id: stand_in,
            },
            target,
        );
    }

    /// The aliases `resolveAlias(start)` found to be circular, which is to outlast the merge.
    fn keep_circular_aliases(&mut self, start: Sym) {
        let mut alias = start;
        while self.is_non_local_alias(alias) {
            let links = self.alias_links(alias);
            if links.is_circular {
                if self.circular_at_merge.contains(&alias) {
                    return;
                }
                self.circular_at_merge.push(alias);
            }
            match links.immediate_target {
                Some(next) if links.is_circular || next != alias => alias = next,
                _ => return,
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

    /// `getMergedSymbol`, for as long as it leads on. A clone can be cloned again, and tsgo gets to the last by asking at each layer
    /// (`resolveEntityName`, `getSymbolOfDeclaration`, `getTypeFromClassOrInterfaceReference`).
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
            _ => {
                let mut whole = sym;
                for _ in 0..32 {
                    match self.merged_symbols.get(&whole) {
                        Some(&next) => whole = next,
                        None => break,
                    }
                }
                whole
            }
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

    /// `symbol.Exports[name]`, as the table has it.
    pub fn export_in_table(&self, sym: Sym, name: Atom) -> Option<Sym> {
        let symbol = self.symbol(sym);
        if symbol.flags.contains(SymFlags::MERGED)
            && let Some(table) = self.merged_exports.get(&sym)
        {
            return table.get(&name).copied();
        }
        Some(Sym {
            file: sym.file,
            id: self.bound(sym.file).lookup(symbol.exports, name)?,
        })
    }

    pub fn export(&self, sym: Sym, name: Atom) -> Option<Sym> {
        let found = self.export_in_table(sym, name)?;
        // `getExportsOfModule` has the symbols as the table has them, and `mergeSymbol` clones one that is not transient.
        Some(if self.is_merged {
            self.canonical(found)
        } else {
            found
        })
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
        // What an alias answers while it is being resolved is not what it answers later.
        if RESOLVING.with(|r| r.borrow().circles) == circles {
            self.memo
                .symbol_flags
                .set_raw(sym, flags.bits() | FLAGS_KNOWN, false);
        }
        flags
    }

    /// `getSymbolFlagsEx`
    fn symbol_flags_uncached(&self, mut symbol: Sym) -> SymFlags {
        let mut flags = self.flags(symbol);
        let mut seen_symbols: SmallVec<[Sym; 8]> = SmallVec::new();
        while self.flags(symbol).contains(SymFlags::ALIAS) {
            let Some(target) = self.alias_links(symbol).alias_target else {
                return SymFlags::all();
            };
            let target = self.export_symbol_of_value_symbol_if_exported(target);
            if self.flags(target).contains(SymFlags::ALIAS) {
                if target == symbol || seen_symbols.contains(&target) {
                    break;
                }
                if seen_symbols.is_empty() {
                    seen_symbols.push(symbol);
                }
                seen_symbols.push(target);
            }
            flags |= self.flags(target);
            // The static member is a property, which is a value.
            if self.static_member_of_same_name(target).is_some() {
                flags |= SymFlags::PROPERTY;
            }
            symbol = target;
        }
        flags
    }

    /// `getParentOfSymbol`. `Symbol::parent` is what a declaration is written in, exported or not. `declareSymbolEx` gives a `Parent`
    /// to what is declared among the exports, be it refused there, and `bindAnonymousDeclaration` to a member of an enum.
    pub fn parent_of_symbol(&self, sym: Sym) -> Option<Sym> {
        let declared = self.symbol(sym);
        if declared.parent.is_none() {
            return None;
        }
        let parent = self.sym(sym.file, declared.parent);
        let bound = self.bound(sym.file);
        let has_parent = declared.flags.contains(SymFlags::ENUM_MEMBER)
            || self.export(parent, declared.name) == Some(sym)
            || bound
                .lookup(bound.symbols[declared.parent.idx()].exports, declared.name)
                .is_some_and(|there| {
                    declared
                        .decls
                        .iter()
                        .any(|&decl| bound.refused_declarations.contains(&(there, decl)))
                });
        has_parent.then_some(parent)
    }

    /// `getExportSymbolOfValueSymbolIfExported`
    pub fn export_symbol_of_value_symbol_if_exported(&self, sym: Sym) -> Sym {
        let exported = self
            .bound(sym.file)
            .export_symbol_of_value_symbol_if_exported(sym.id);
        if exported == sym.id {
            sym
        } else {
            self.sym(sym.file, exported)
        }
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
            match self.alias_target(sym) {
                Some(next) if next != sym => sym = next,
                _ => return false,
            }
        }
        false
    }

    /// What `decl` asks of `getExternalModuleMember`, if it is `import { a }`, `export { a } from` or `const { a } = require(..)`: the
    /// module specifier, how that is resolved (`getModeForUsageLocation`), and the name.
    pub fn external_module_member_of(
        &self,
        file: FileId,
        decl: Decl,
    ) -> Option<(Atom, ResolutionMode, Atom)> {
        let hir = self.hir(file);
        match decl {
            Decl::ImportSpec(s) => {
                let import = &hir[hir[s].import];
                let mode = self.mode_of_import(file, import.mode);
                Some((import.spec, mode, hir[s].imported))
            }
            Decl::ExportSpec(s) => {
                let export = &hir[hir[s].export];
                let mode = self.mode_of_import(file, export.mode);
                export
                    .spec
                    .is_some()
                    .then_some((export.spec, mode, hir[s].local))
            }
            Decl::Require(pat) => {
                let (spec, name) = self.bound(file).required_by(hir, pat)?;
                Some((spec, ResolutionMode::Require, name?))
            }
            _ => None,
        }
    }

    /// Whether `getTargetOfAliasDeclaration` of `sym` goes through `getExternalModuleMember` for a module that has `export =`.
    fn is_named_import_from_export_equals(&self, sym: Sym) -> bool {
        self.declaration_of_alias_symbol(sym)
            .and_then(|(file, decl)| {
                let (spec, mode, _) = self.external_module_member_of(file, decl)?;
                self.module_of_specifier_as(file, spec, mode)
            })
            .is_some_and(|m| self.export(m, known::export_equals).is_some())
    }

    /// `NameResolver.Resolve` without a `nameNotFoundMessage`: what `name` means in `scope` of `file`.
    pub fn resolve_name(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Option<Sym> {
        self.resolve(file, scope, name, meaning, false)
            .unwrap_or(None)
    }

    /// `NameResolver.Resolve`. `Err`: the error it reports where it returns nil for a reason of its own, which takes the place of
    /// the one for a name that is not found.
    pub fn resolve_name_or_error(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) -> Result<Option<Sym>, u32> {
        self.resolve(file, scope, name, meaning, true)
            .map_err(|error| error.0)
    }

    /// The same, with `propertyWithInvalidInitializer` next to 2301 and 2844. `reports_errors`: `nameNotFoundMessage != nil`.
    pub fn resolve(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool,
    ) -> Result<Option<Sym>, (u32, MemberId)> {
        // `getSymbol`
        let lookup = &mut |_: SymbolTable, held: Option<Sym>, meaning: SymFlags| {
            held.filter(|&sym| self.means(sym, meaning))
        };
        self.resolve_with(file, scope, name, meaning, reports_errors, lookup)
    }

    /// The same. `lookup`: `NameResolver.Lookup`, which is given the table, what it holds under `name`, and the meaning.
    pub fn resolve_with(
        &self,
        file: FileId,
        mut scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
        reports_errors: bool,
        lookup: &mut dyn FnMut(SymbolTable, Option<Sym>, SymFlags) -> Option<Sym>,
    ) -> Result<Option<Sym>, (u32, MemberId)> {
        let bound = self.bound(file);
        // `lastLocation`: the kind of the scope the search has just left.
        let mut from = ScopeKind::Block;
        while scope.is_some() {
            if let Some(code) = bound.type_parameter_out_of_reach(scope, name, meaning) {
                return Err((code, MemberId::NONE));
            }
            let s = &bound.scopes[scope.idx()];
            if reports_errors
                && let Some(invalid) = bound.property_with_invalid_initializer(scope, name, meaning)
            {
                // Nil, whatever is found. The property remembered last, the outermost, is the one the error is about.
                return Err(self
                    .resolve_with(file, s.parent, name, meaning, true, lookup)
                    .err()
                    .unwrap_or(invalid));
            }
            // The `infer`s of a conditional type are seen from its true branch, not from the `extends` clause that declares them.
            if !matches!(from, ScopeKind::Extends) {
                let held = bound.lookup(s.locals, name).map(|id| self.sym(file, id));
                if let Some(sym) = lookup(SymbolTable::Locals(file, scope), held, meaning)
                    && bound.is_seen_from(from, self.flags(sym), meaning)
                {
                    return Ok(Some(sym));
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
                let container = self.sym(file, s.symbol);
                // "First see if the module has an export default and if the local name of that export default matches."
                let of_local = bound.export_symbol_of_local(scope, name);
                if of_local.is_some() {
                    let default = self.sym(file, of_local);
                    if self.export(container, known::default) == Some(default)
                        && self.flags(default).intersects(meaning)
                    {
                        return Ok(Some(default));
                    }
                }
                let held = self.export(container, name);
                if !held.is_some_and(|sym| self.flags(sym).contains(SymFlags::EXPORT_ONLY))
                    && let Some(sym) = lookup(SymbolTable::Exports(container), held, visible)
                {
                    return Ok(Some(sym));
                }
            }
            from = s.kind;
            scope = s.parent;
        }
        let held = self.globals.get(&name).copied();
        Ok(lookup(SymbolTable::Globals, held, meaning))
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
        self.canonical(match self.export(module, known::export_equals) {
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
        })
    }

    /// `canHaveSyntheticDefault`: the module, or what it says it is with `export =`, if it can have a default that is made up.
    /// `usage` is how the specifier is emitted where it is asked for (`getEmitSyntaxForModuleSpecifierExpression`).
    pub fn synthetic_default(&self, usage: impl Usage, module: Sym) -> Option<Sym> {
        let usage = usage.mode(self);
        let is_file = self
            .symbol(module)
            .decls
            .iter()
            .any(|d| matches!(d, Decl::File));
        if is_file && usage == ResolutionMode::Import {
            match self.module(module.file).implied_format {
                // To Node a CommonJS module is its own default, whatever it declares.
                ResolutionMode::Require if self.options.module.is_node() => {
                    return Some(self.external_module_symbol(module));
                }
                // Between ECMAScript modules nothing is made up.
                ResolutionMode::Import => return None,
                _ => {}
            }
        }
        let can = if !is_file || self.hir(module.file).kind == FileKind::Declaration {
            // One that is only declared may turn out to have one, unless it says what its default is or that it is an ECMAScript module.
            // `resolveExportByName`: with `export =` both are properties of the value. `isSyntacticDefault`: a member of an enum is none.
            let exporter = self.module_value(module);
            self.export(exporter, known::default)
                .is_none_or(|default| self.flags(default).contains(SymFlags::ENUM_MEMBER))
                && self
                    .atoms
                    .lookup(b"__esModule")
                    .is_none_or(|name| self.export(exporter, name).is_none())
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
        can.then(|| self.external_module_symbol(module))
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
            return Some(self.external_module_symbol(module));
        }
        self.module_export(module, known::default)
    }

    /// `getExportsOfModule(module)[name]`
    pub fn module_export(&self, module: Sym, name: Atom) -> Option<Sym> {
        // Without `export =`, what the module exports itself is in the table as it is, and without an `export *` nothing else is.
        if self.export(module, known::export_equals).is_none() {
            if let Some(found) = self.export(module, name) {
                return Some(found);
            }
            if name == known::default || self.export_stars_of(module).is_empty() {
                return None;
            }
        }
        let find = |exports: &[(Atom, Sym)]| {
            let found = exports.binary_search_by_key(&name, |export| export.0);
            found.ok().map(|i| exports[i].1)
        };
        // While symbols are put together nothing is kept.
        if self.is_merged {
            find(self.exports_of_module(module))
        } else {
            find(&self.exports_of_module_worker(module).resolved_exports)
        }
    }

    /// `getExportsOfModule`, sorted by name.
    pub fn exports_of_module(&self, module: Sym) -> &[(Atom, Sym)] {
        &self.module_links(module).resolved_exports
    }

    /// `moduleSymbolLinks.Get(module)`, filled in by `getExportsOfModule`.
    pub fn module_links(&self, module: Sym) -> &ModuleSymbolLinks {
        if let Some(kept) = self.memo.module_links.get_ref(&module) {
            return kept;
        }
        self.memo
            .module_links
            .insert_ref(module, self.exports_of_module_worker(module))
    }

    /// `getExportsOfModuleWorker`
    fn exports_of_module_worker(&self, module: Sym) -> ModuleSymbolLinks {
        let mut visit = ExportsVisit::default();
        // A module defined by an `export =` consists of one export that needs to be resolved.
        let mut exports = self
            .visit_exports(Some(self.module_value(module)), None, false, &mut visit)
            .unwrap_or_default();
        // What it exports besides counts if it is a type or a namespace and no value.
        if self.export(module, known::export_equals).is_some() {
            for (name, symbol) in self.each_export(module) {
                if name == known::export_equals || exports.contains_key(&name) {
                    continue;
                }
                let flags = self.symbol_flags(symbol);
                if flags.intersects(SymFlags::TYPE | SymFlags::NAMESPACE)
                    && !flags.intersects(SymFlags::VALUE)
                {
                    exports.insert(name, symbol);
                }
            }
        }
        let mut resolved_exports: Vec<(Atom, Sym)> = exports.into_iter().collect();
        resolved_exports.sort_unstable();
        let mut type_only_export_star_map: Vec<(Atom, (FileId, StmtId))> = visit
            .type_only_export_star_map
            .into_iter()
            .filter(|star| !visit.non_type_only_names.contains(&star.0))
            .collect();
        type_only_export_star_map.sort_unstable();
        visit
            .export_collisions
            .sort_unstable_by_key(|collision| (collision.duplicate, collision.name));
        ModuleSymbolLinks {
            resolved_exports: resolved_exports.into(),
            type_only_export_star_map: type_only_export_star_map.into(),
            export_collisions: visit.export_collisions.into(),
        }
    }

    /// `visit` of `getExportsOfModuleWorker`. `export_star`: the `export *` that led here. `is_type_only`: that one or one before it says
    /// `type`.
    fn visit_exports(
        &self,
        symbol: Option<Sym>,
        export_star: Option<(FileId, StmtId)>,
        is_type_only: bool,
        visit: &mut ExportsVisit,
    ) -> Option<FxHashMap<Atom, Sym>> {
        let symbol = symbol?;
        // Before it is asked whether it has been here: a plain `export *` takes back what an `export type *` of the same module said.
        if !is_type_only {
            let names = self.each_export(symbol).map(|export| export.0);
            visit.non_type_only_names.extend(names);
        }
        if visit.visited_symbols.contains(&symbol) {
            return None;
        }
        visit.visited_symbols.push(symbol);
        let mut symbols: FxHashMap<Atom, Sym> = self.each_export(symbol).collect();
        let mut nested_symbols: FxHashMap<Atom, Sym> = FxHashMap::default();
        // `ExportCollisionTable`: who exported the name first.
        let mut lookup_table: FxHashMap<Atom, (FileId, StmtId)> = FxHashMap::default();
        for node in self.export_stars_of(symbol) {
            let StmtKind::ExportStar {
                spec,
                type_only,
                mode,
                ..
            } = self.hir(node.0)[node.1].kind
            else {
                continue;
            };
            let mode = self.mode_of_import(node.0, mode);
            let resolved_module = self.module_of_specifier_as(node.0, spec, mode);
            let is_type_only = is_type_only || type_only;
            let Some(exported) =
                self.visit_exports(resolved_module, Some(node), is_type_only, visit)
            else {
                continue;
            };
            // `extendExportSymbols`
            for (name, source) in exported {
                if name == known::default {
                    continue;
                }
                let Some(&target) = nested_symbols.get(&name) else {
                    nested_symbols.insert(name, source);
                    lookup_table.insert(name, node);
                    continue;
                };
                // What the module exports itself settles it.
                if export_star.is_none()
                    && name != known::export_equals
                    && !symbols.contains_key(&name)
                    && self.resolve_symbol(target) != self.resolve_symbol(source)
                {
                    visit.export_collisions.push(ExportCollision {
                        duplicate: node,
                        first: lookup_table[&name],
                        name,
                    });
                }
            }
        }
        for (name, nested) in nested_symbols {
            symbols.entry(name).or_insert(nested);
        }
        if let Some(star) = export_star
            && matches!(
                self.hir(star.0)[star.1].kind,
                StmtKind::ExportStar {
                    type_only: true,
                    ..
                }
            )
        {
            let names = symbols.keys().map(|&name| (name, star));
            visit.type_only_export_star_map.extend(names);
        }
        Some(symbols)
    }

    /// `symbol.Exports[InternalSymbolNameExportStar].Declarations`
    fn export_stars_of(&self, symbol: Sym) -> SmallVec<[(FileId, StmtId); 4]> {
        let mut stars = SmallVec::new();
        for &part in self.parts(symbol).iter() {
            let of_file = self.bound(part.file).export_stars.iter();
            stars.extend(
                of_file
                    .filter(|star| star.0 == part.id)
                    .map(|star| (part.file, star.1)),
            );
        }
        stars
    }

    /// `resolveSymbol`. `None`: `unknownSymbol`.
    pub fn resolve_symbol(&self, symbol: Sym) -> Option<Sym> {
        let flags = self.flags(symbol);
        // `IsNonLocalAlias`
        if flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
        {
            self.resolve_alias(symbol)
        } else {
            Some(symbol)
        }
    }

    /// Whether all there is to import from `module` can be told. What `export =` gives has properties, which can be imported as well.
    /// `declare module "m";` has whatever is asked of it. What a JSON file has is up to what is in it. What its `export *` lead to
    /// makes no difference. `visit` of `getExportsOfModuleWorker` passes on the export table of the module a specifier resolves to,
    /// and nothing if it resolves to none or the module has no table.
    pub fn has_known_exports(&self, module: Sym) -> bool {
        if let Some(known) = self.memo.has_known_exports.get(&module) {
            return known;
        }
        self.memo
            .has_known_exports
            .insert(module, self.has_known_exports_uncached(module))
    }

    fn has_known_exports_uncached(&self, module: Sym) -> bool {
        self.export(module, known::export_equals).is_none()
            && self.symbol(module).exports.is_some()
            && !self.is_shorthand_ambient_module_symbol(module)
            && !self.module(module.file).path.ends_with(".json")
    }

    /// `typeOnlyExportStarMap[name]` of `module`: the `export type *` that is the only way it has `name`.
    pub fn type_only_export_star(&self, module: Sym, name: Atom) -> Option<(FileId, StmtId)> {
        if !self.has_type_only_stars {
            return None;
        }
        let map = &self.module_links(module).type_only_export_star_map;
        let found = map.binary_search_by_key(&name, |star| star.0);
        found.ok().map(|i| map[i].1)
    }

    pub fn is_type_only_star_export(&self, module: Sym, name: Atom) -> bool {
        self.type_only_export_star(module, name).is_some()
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
            find(self.resolve_alias(namespace)?)
        })
    }

    /// A member of a namespace, a module or an enum.
    pub fn namespace_member(&self, container: Sym, name: Atom) -> Option<Sym> {
        if self.flags(container).intersects(SymFlags::MODULE) {
            return self.module_export(container, name);
        }
        self.export(container, name)
    }

    /// Where the way from `sym` ends: at what is no alias at all. tsgo has no such function: who asks wants a meaning, and
    /// `resolve_alias_as` is for that.
    #[inline]
    pub fn resolve_alias_if_needed(&self, sym: Sym) -> Option<Sym> {
        self.resolve_alias_as(sym, SymFlags::empty())
    }

    /// `resolveAlias`. `None`: `unknownSymbol`.
    pub fn resolve_alias(&self, sym: Sym) -> Option<Sym> {
        if !self.flags(sym).contains(SymFlags::ALIAS) {
            return Some(sym);
        }
        match self.alias_symbol_links.get_ref(&sym) {
            Some(known) => known.alias_target,
            None => self.alias_links(sym).alias_target,
        }
    }

    /// The loop at the end of `resolveEntityName`: the first symbol from `sym` on that has `meaning` itself; where the way ends if none
    /// has.
    pub fn resolve_alias_as(&self, mut sym: Sym, meaning: SymFlags) -> Option<Sym> {
        for _ in 0..32 {
            let flags = self.flags(sym);
            if flags.intersects(meaning) || !flags.contains(SymFlags::ALIAS) {
                return Some(sym);
            }
            let next = self.alias_links(sym).alias_target?;
            if next == sym {
                return None;
            }
            sym = next;
        }
        None
    }

    /// `IsNonLocalAlias`: an alias and nothing else.
    pub fn is_non_local_alias(&self, sym: Sym) -> bool {
        let flags = self.flags(sym);
        flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
    }

    /// `resolveAlias`, with all that it leaves in `aliasSymbolLinks`.
    pub fn alias_links(&self, sym: Sym) -> AliasSymbolLinks {
        if let Some(known) = self.alias_symbol_links.get(&sym) {
            return known;
        }
        // `pushTypeResolution`: an alias that is asked for while it is being resolved is in a circle with everything begun since.
        let is_pushed = RESOLVING.with(|r| {
            let mut r = r.borrow_mut();
            let start = r.resolutions.iter().position(|begun| begun.0 == sym);
            if let Some(start) = start {
                for begun in &mut r.resolutions[start..] {
                    begun.1 = false;
                }
            }
            let is_pushed = start.is_none() && r.resolutions.len() < 100;
            if is_pushed {
                r.resolutions.push((sym, true));
            } else {
                r.circles += 1;
            }
            is_pushed
        });
        if !is_pushed {
            return AliasSymbolLinks::default();
        }
        let mut links = AliasSymbolLinks::default();
        if let Some((file, decl)) = self.declaration_of_alias_symbol(sym) {
            let type_only = &mut links.type_only_declaration;
            let target = self.target_of_alias_declaration(sym, file, decl, type_only);
            // `getExternalModuleMember` finds the symbol as the table of the module has it, which `mergeSymbol` goes by.
            // `resolveEntityName` and `resolveExternalModuleSymbol` end with `getMergedSymbol`.
            let is_as_in_table =
                !self.is_merged && self.external_module_member_of(file, decl).is_some();
            links.immediate_target = if is_as_in_table {
                target
            } else {
                target.map(|target| self.canonical(target))
            };
            links.alias_target = match links.immediate_target {
                Some(target) if self.is_non_local_alias(target) => {
                    self.resolve_indirection_alias(target, type_only)
                }
                target => target,
            };
        }
        // `popTypeResolution`
        let (begun, is_kept) = RESOLVING.with(|r| {
            let mut r = r.borrow_mut();
            let (begun, is_kept) = (r.resolutions.pop(), r.is_kept);
            if r.resolutions.is_empty() {
                r.is_kept = true;
            }
            (begun, is_kept)
        });
        if !begun.is_some_and(|begun| begun.1) {
            links.alias_target = None;
            links.is_circular = true;
        }
        if is_kept {
            self.alias_symbol_links.insert(sym, links)
        } else {
            links
        }
    }

    /// `tryResolveAlias`. `None`: `sym` is being resolved.
    fn try_resolve_alias(&self, sym: Sym) -> Option<AliasSymbolLinks> {
        if self.alias_symbol_links.get_ref(&sym).is_none() {
            let is_begun = RESOLVING.with(|r| {
                let mut r = r.borrow_mut();
                let is_begun = r.resolutions.iter().any(|begun| begun.0 == sym);
                // Asked first, it would have been resolved. The last is who is asking, whoever was first.
                if is_begun && r.resolutions.last().is_some_and(|last| last.0 != sym) {
                    r.is_kept = false;
                    r.circles += 1;
                }
                is_begun
            });
            if is_begun {
                return None;
            }
        }
        Some(self.alias_links(sym))
    }

    /// `onFailedToResolveSymbol`, as far as aliases are the wiser for it: `getSpellingSuggestionForName` resolves all those it looks at.
    fn on_failed_to_resolve_symbol(
        &self,
        file: FileId,
        scope: ScopeId,
        name: Atom,
        meaning: SymFlags,
    ) {
        // `checkAndReportErrorForUsingTypeAsNamespace`: what is wrong is known.
        let types = SymFlags::TYPE.difference(SymFlags::NAMESPACE);
        if meaning == SymFlags::NAMESPACE && self.resolve_name(file, scope, name, types).is_some() {
            return;
        }
        // `checkAndReportErrorForExportingPrimitiveType`, `checkAndReportErrorForUsingTypeAsValue`
        if matches!(
            self.atoms.bytes(name),
            b"any" | b"string" | b"number" | b"boolean" | b"never" | b"unknown"
        ) {
            return;
        }
        let try_resolve_alias = &mut |sym| {
            let target = self.try_resolve_alias(sym)?.alias_target;
            Some(target.map_or(SymFlags::all(), |target| self.flags(target)))
        };
        self.suggested_symbol_for_nonexistent_symbol(file, scope, name, meaning, try_resolve_alias);
    }

    /// `resolveIndirectionAlias`. `type_only`: `typeOnlyDeclaration` of the source.
    fn resolve_indirection_alias(
        &self,
        target: Sym,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let links = self.alias_links(target);
        *type_only = type_only.or(links.type_only_declaration);
        links.alias_target
    }

    /// `IsTypeOnlyImportOrExportDeclaration`
    pub fn is_type_only_import_or_export_declaration(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        match decl {
            Decl::ImportDefault(import) | Decl::ImportNamespace(import) => hir[import].type_only,
            Decl::ImportSpec(s) => hir[s].type_only || hir[hir[s].import].type_only,
            Decl::ImportEquals(import) => hir[import].flags.contains(Flags::TYPE_ONLY),
            Decl::ExportSpec(s) => hir[s].type_only || hir[hir[s].export].type_only,
            Decl::ExportStarAs(statement) => matches!(
                hir[statement].kind,
                StmtKind::ExportStar {
                    type_only: true,
                    ..
                }
            ),
            _ => false,
        }
    }

    /// `markSymbolOfAliasDeclarationIfTypeOnly`, of the declaration `decl` in `file` of `sym`.
    fn mark_symbol_of_alias_declaration_if_type_only(
        &self,
        (sym, file, decl): (Sym, FileId, Decl),
        export_star_declaration: Option<(FileId, StmtId)>,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) {
        if type_only.is_some() {
            return;
        }
        *type_only = if self.is_type_only_import_or_export_declaration(file, decl) {
            Some(TypeOnlyDeclaration::Alias(sym, file, decl))
        } else {
            export_star_declaration.map(|(of, star)| TypeOnlyDeclaration::ExportStar(of, star))
        };
    }

    /// `resolveExternalModuleSymbol(module, dontResolveAlias)`: `module`, or its `export =` as it is.
    fn external_module_symbol(&self, module: Sym) -> Sym {
        self.export(module, known::export_equals).unwrap_or(module)
    }

    /// `resolveESModuleSymbol`, as far as the tables go.
    fn resolve_es_module_symbol(
        &self,
        module: Sym,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let symbol = self.external_module_symbol(module);
        if self.is_non_local_alias(symbol) {
            // Where the tables lose the way, types may know it: who goes on from here does so a step at a time.
            self.resolve_indirection_alias(symbol, type_only)
                .or(Some(symbol))
        } else {
            Some(symbol)
        }
    }

    /// `IsAliasSymbolDeclaration`
    fn is_alias_symbol_declaration(&self, file: FileId, decl: Decl) -> bool {
        let hir = self.hir(file);
        let e = match decl {
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
        expression_is_alias(hir, e)
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

    /// `isShorthandAmbientModuleSymbol`: `ValueDeclaration`, which of several module declarations is the first, is
    /// `declare module "m";`.
    pub fn is_shorthand_ambient_module_symbol(&self, module: Sym) -> bool {
        matches!(
            self.decls_of(module).first(),
            Some(&(file, Decl::Module(id))) if !self.hir(file)[id].has_body
        )
    }

    /// `getImmediateAliasedSymbol`
    pub fn alias_target(&self, sym: Sym) -> Option<Sym> {
        self.alias_links(sym).immediate_target
    }

    /// `getTargetOfAliasDeclaration`, of the declaration `decl` in `file` of `sym`: one step, to what may be an alias again.
    /// `type_only`: `typeOnlyDeclaration` of `sym`.
    fn target_of_alias_declaration(
        &self,
        sym: Sym,
        file: FileId,
        decl: Decl,
        type_only: &mut Option<TypeOnlyDeclaration>,
    ) -> Option<Sym> {
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let node = (sym, file, decl);
        let hir = self.hir(file);
        let bound = self.bound(file);
        // `getTargetOfImportSpecifier`, `getTargetOfExportSpecifier`
        if let Some((spec, mode, name)) = self.external_module_member_of(file, decl) {
            let target = self
                .module_of_specifier_as(file, spec, mode)
                .and_then(|module| {
                    // `{ default as d }` is the default import by another spelling, but not in a binding pattern.
                    if name == known::default && !matches!(decl, Decl::Require(_)) {
                        return self.default_of_module(file, module);
                    }
                    // `getExternalModuleMember`, `getExportOfModule`
                    self.resolve_es_module_symbol(module, type_only);
                    if self.is_shorthand_ambient_module_symbol(module) {
                        return Some(module);
                    }
                    let star = self.type_only_export_star(module, name);
                    self.mark_symbol_of_alias_declaration_if_type_only(node, star, type_only);
                    self.module_export(module, name)
                });
            self.mark_symbol_of_alias_declaration_if_type_only(node, None, type_only);
            return target;
        }
        let target = match decl {
            // `getTargetOfImportClause`: without the module nothing is marked.
            Decl::ImportDefault(import) => {
                let module = self.module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )?;
                self.default_of_module(file, module)
            }
            // `getTargetOfNamespaceImport`
            Decl::ImportNamespace(import) => self
                .module_of_specifier_as(
                    file,
                    hir[import].spec,
                    self.mode_of_import(file, hir[import].mode),
                )
                .and_then(|module| {
                    let symbol = self.resolve_es_module_symbol(module, type_only)?;
                    if self.is_commonjs_import_of_esm_file(file, module)
                        && let Some(found) = self.module_exports_export(symbol)
                    {
                        return Some(found);
                    }
                    Some(symbol)
                }),
            Decl::ImportEquals(import) => match hir[import].target {
                ImportEqualsTarget::Require(spec) => self
                    .module_of_specifier_as(file, spec, ResolutionMode::Require)
                    .map(|module| self.required_module_symbol(module)),
                // Nothing is marked.
                ImportEqualsTarget::Entity(names) => {
                    let names: SmallVec<[Atom; 4]> = hir.ids(names).collect();
                    // `getSymbolOfPartOfRightHandSideOfImportEquals`: `import a = b` is about a namespace, `import a = b.c` about anything.
                    let meaning = if names.len() == 1 {
                        SymFlags::NAMESPACE
                    } else {
                        all
                    };
                    let scope = bound.import_equals_scope[import.idx()];
                    let target = self.resolve_entity(file, scope, &names, meaning);
                    // `globalThisSymbol` is found, and has no `Sym`.
                    if target.is_none()
                        && names[0] != known::globalThis
                        && self
                            .resolve_name(file, scope, names[0], SymFlags::NAMESPACE)
                            .is_none()
                    {
                        self.on_failed_to_resolve_symbol(
                            file,
                            scope,
                            names[0],
                            SymFlags::NAMESPACE,
                        );
                    }
                    return target;
                }
            },
            // Without `from`.
            Decl::ExportSpec(spec) => {
                let scope = bound.export_scope[hir[spec].export.idx()];
                let target = self.resolve_name(file, scope, hir[spec].local, all);
                if target.is_none() {
                    self.on_failed_to_resolve_symbol(file, scope, hir[spec].local, all);
                }
                target
            }
            // `getTargetOfNamespaceExportDeclaration`
            Decl::UmdGlobal(_) => Some(self.external_module_symbol(self.file_symbol(file))),
            // `getTargetOfNamespaceExport`
            Decl::ExportStarAs(stmt) => {
                let StmtKind::ExportStar { spec, mode, .. } = hir[stmt].kind else {
                    return None;
                };
                self.module_of_specifier_as(file, spec, self.mode_of_import(file, mode))
                    .and_then(|module| self.resolve_es_module_symbol(module, type_only))
            }
            // `getTargetOfImportEqualsDeclaration`: the whole of what is required.
            Decl::Require(pat) => {
                let (spec, _) = bound.required_by(hir, pat)?;
                self.module_of_specifier_as(file, spec, ResolutionMode::Require)
                    .map(|module| self.required_module_symbol(module))
            }
            _ => return self.target_of_alias_like_expression(file, decl),
        };
        self.mark_symbol_of_alias_declaration_if_type_only(node, None, type_only);
        target
    }

    /// `getTargetOfImportEqualsDeclaration`: the target of `import x = require(..)` and of `const x = require(..)` of `module`.
    fn required_module_symbol(&self, module: Sym) -> Sym {
        let resolved = self.external_module_symbol(module);
        self.module_exports_export(resolved).unwrap_or(resolved)
    }

    /// `getTargetOfExportAssignment`, `getTargetOfBinaryExpression`: `getTargetOfAliasLikeExpression`, as far as the tables go.
    fn target_of_alias_like_expression(&self, file: FileId, decl: Decl) -> Option<Sym> {
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let hir = self.hir(file);
        let bound = self.bound(file);
        match decl {
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
