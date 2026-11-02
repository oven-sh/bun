use bun_ast::Loader;
use bun_core::fmt::hex_byte_lower;
use bun_core::strings::{self, is_valid_utf8};
use bun_options_types::aot_options::{ParameterThatStartsWorkers, PlaceIsReachedBy};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, ClassOwner, CommonJsVariable, Decl, FnOwner, MemberOwner,
    Parent, PatParent, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue, TreeNode, push_children};
use bun_sema::hir::{
    BinOp, Branches, CallId, ClassId, ExportSpecId, ExprId, ExprKind, File, Flags, FnBody, FnId,
    FnKind, MemberId, MemberKind, NodeData, ParamId, PatId, PatKind, PropKey, PropKind, Span,
    StmtKind,
};
use bun_sema::import_sites::{
    ENCODERS, Encoder, ImportSiteKind, ImportSpecifier, find_values_passed_for, is_exported,
};
use bun_sema::messages::Category;
use bun_sema::program::{CodeAnswer, CodeView, ComputedTargets, FileId};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::TextLocator;
use bun_sema_driver::host::to_native;
use smallvec::SmallVec;

use crate::builtins::{BuiltinId, Intrinsic, Resolved, RuntimeModule, table};
use crate::compile::{CodeOfWorkers, EntryPointPaths};
use crate::diagnostics::{ShownPosition, new_driver_diagnostic, position_of_diagnostic};
use crate::ir::parallel::{InParallel, map_each};
use crate::load::loaders::{loader_named_by_path, script_kind_of};
use crate::load::module_paths::{
    compute_module_path, compute_relative_path, with_separators_of_host,
};
use crate::load::named_loads::find_import_of;
use crate::load::runtime_modules::find_module_named;
use crate::load::source_provider::SourceProvider;
use crate::load::sources::parsed_source_in as parsed_source;
use crate::load::{SourceKind, is_host_path, is_in_node_modules};
use crate::module_keys::{is_name_of_text, is_url_with_text, name_of_text};
use crate::options::{EntryText, PathOptions};
use crate::statistics::{LimitId, LimitValues};
use core::any::Any;
use core::cell::RefCell;
use std::rc::Rc;

/// Code that the program starts a Worker with: a file that it embeds with the `file` loader, a file that it names by a path, or a text that it holds.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct WorkerFile {
    /// Of a text: `embedded_path`.
    pub source_path: Vec<u8>,
    /// What the import answers: the path of the copy in the executable. Of a file that is named by a path: the path of its module there.
    /// Of a text: what the run time knows it by, the `data:` URL that holds it or its `name_of_text`.
    pub embedded_path: Vec<u8>,
    /// The compiler lost track of the path and some Worker gets an unknown value, or another native function looks at the path too.
    pub is_guess: bool,
    /// The Worker may also get an options object.
    pub has_options: bool,
    /// Of a file that the engine reported: one `new Worker()` that may get the path.
    pub started_at: Option<ShownPosition>,
    /// What a text says, decoded, and the number of the loader that reads it.
    pub text: Option<(Vec<u8>, u8)>,
    /// The program writes the path out, and nothing else says that the file is part of it.
    pub is_named_by_path: bool,
}

impl WorkerFile {
    pub(crate) fn entry_text(&self) -> Option<EntryText> {
        let (contents, loader) = self.text.clone()?;
        let is_loader = |it: &&Loader| **it as u8 == loader;
        Some(EntryText {
            name: self.embedded_path.clone(),
            contents,
            loader: *LOADERS_OF_CODE.iter().find(is_loader)?,
        })
    }
}

// Files that hand an export on to one another in a circle end the search.
const MOST_REEXPORTS: usize = 8;
const LOADERS_OF_CODE: [Loader; 4] = [Loader::Js, Loader::Jsx, Loader::Ts, Loader::Tsx];

pub(crate) struct WorkerSearch<'a> {
    pub limits: &'a LimitValues,
    pub loaders: &'a [(Vec<u8>, Loader)],
    pub paths: &'a PathOptions,
    pub runs_in_place: bool,
    pub provider: &'a dyn SourceProvider,
    /// The file that the build takes for an entry point which is written so, in the format of the checker.
    pub resolve_entry_point: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
    /// The file that a name without `./` in front leads to from the root directory: that of a package, else one in the directory.
    pub resolve_bare_name: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
    /// The files under names that are known in part, `resolve_names_known_in_part`.
    pub find_files_named_in_part: &'a FindFilesNamedInPart<'a>,
    /// Where the build runs, in the format of the checker. `bun run` looks there for what a relative path names, and `resolve_entry_point` does too.
    pub working_directory: &'a [u8],
    /// Whether a program below this one in the realm holds the code of the file at a `WorkerFile::source_path`.
    pub is_held_below: &'a dyn Fn(&[u8]) -> bool,
    /// What the programs below start Workers from when they are called. Ascending.
    pub parameters_below: &'a [ParameterThatStartsWorkers],
    /// The file that an import leads to, whichever program holds it: the file that imports, and what it writes. All in the format of the checker.
    pub resolve_import: &'a dyn Fn(&[u8], &[u8]) -> Option<Vec<u8>>,
    /// Programs are built above this one. They do not read its files, so they are told which of its functions start Workers from what they are passed.
    pub is_built_upon: bool,
}

#[derive(Copy, Clone)]
pub(crate) enum SearchedFrom<'a> {
    FolderOf(&'a [u8]),
    RootDirectory,
    WorkingDirectory,
}

type FindFilesNamedInPart<'a> =
    dyn Fn(SearchedFrom<'_>, &[(&[u8], Option<&[u8]>)]) -> Option<Vec<Vec<u8>>> + 'a;

/// A program of which only some files are searched. What they lead to in the others is followed there.
pub(crate) struct SomeFilesOf<'v, 's> {
    pub all: &'v dyn CodeView<'s>,
    pub searched: Vec<FileId>,
}

impl<'s> CodeView<'s> for SomeFilesOf<'_, 's> {
    fn atoms(&self) -> &Interner<'s> {
        self.all.atoms()
    }

    fn hir(&self, file: FileId) -> &File<'s> {
        self.all.hir(file)
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        self.all.bound(file)
    }

    fn analysis(&self, file: FileId) -> &FileAnalysis<'s> {
        self.all.analysis(file)
    }

    fn answers(&self, file: FileId) -> Option<(&[CodeAnswer<'s>], &[CodeAnswer<'s>])> {
        self.all.answers(file)
    }

    fn file_name(&self, file: FileId) -> &[u8] {
        self.all.file_name(file)
    }

    fn entry_points(&self) -> &[FileId] {
        self.all.entry_points()
    }

    fn compiled_files(&self) -> &[FileId] {
        &self.searched
    }

    fn host_payload(&self, file: FileId) -> Option<&(dyn Any + Send + Sync)> {
        self.all.host_payload(file)
    }
}

fn is_absolute(path: &[u8]) -> bool {
    path.starts_with(b"/") || matches!(path, [drive, b':', b'/', ..] if drive.is_ascii_alphabetic())
}

fn with_forward_slashes(mut path: Vec<u8>) -> Vec<u8> {
    for byte in &mut path {
        if *byte == b'\\' {
            *byte = b'/';
        }
    }
    path
}

// As `import.meta.url` and `pathToFileURL()` write it when the program runs: they escape what Node escapes, and the parser of URLs escapes the rest.
pub(crate) fn write_file_url(path: &[u8]) -> Option<Vec<u8>> {
    if !is_absolute(path) {
        return None;
    }
    let mut url = b"file://".to_vec();
    if !path.starts_with(b"/") {
        url.push(b'/');
    }
    for &byte in path {
        let is_written_as_it_is = byte.is_ascii_graphic()
            && !matches!(
                byte,
                b'"' | b'#'
                    | b'%'
                    | b'<'
                    | b'>'
                    | b'?'
                    | b'`'
                    | b'{'
                    | b'}'
                    | b'\\'
                    | b'['
                    | b']'
                    | b'^'
                    | b'|'
                    | b'~'
            );
        if is_written_as_it_is {
            url.push(byte);
        } else {
            url.push(b'%');
            url.extend(hex_byte_lower(byte).map(|digit| digit.to_ascii_uppercase()));
        }
    }
    Some(url)
}

fn read_file_url(url: &[u8]) -> Option<Vec<u8>> {
    let written = url.strip_prefix(b"file://")?;
    if !written.starts_with(b"/") || strings::index_of_any(written, b"?#").is_some() {
        return None;
    }
    let mut path = Vec::with_capacity(written.len());
    let mut rest = written;
    while let [byte, following @ ..] = rest {
        rest = following;
        if *byte != b'%' {
            path.push(*byte);
            continue;
        }
        let [high, low, following @ ..] = rest else {
            return None;
        };
        let digit = |digit: u8| (digit as char).to_digit(16);
        path.push((digit(*high)? * 16 + digit(*low)?) as u8);
        rest = following;
    }
    match is_absolute(&path[1..]) {
        true => Some(path.split_off(1)),
        false => Some(path),
    }
}

// `path.join()` and `path.resolve()` of node:path, for paths with forward slashes. `None`: the answer hangs on the working directory, or a part is written in another way.
fn join_paths(parts: &[Vec<u8>], resolves: bool) -> Option<Vec<u8>> {
    let first = match resolves {
        true => parts.iter().rposition(|part| is_absolute(part))?,
        false => 0,
    };
    let mut segments: Vec<&[u8]> = Vec::new();
    let root_length = match &parts.get(first)?[..] {
        [b'/', ..] => 1,
        part if is_absolute(part) => 3,
        _ => 0,
    };
    for (index, part) in parts[first..].iter().enumerate() {
        if strings::contains_char(part, b'\\') || strings::contains_char(part, 0) {
            return None;
        }
        let part = &part[if index == 0 { root_length } else { 0 }..];
        for segment in strings::split(part, b"/") {
            match segment {
                b"" | b"." => {}
                b".." if segments.last().is_some_and(|&last| last != b"..") => {
                    segments.pop();
                }
                b".." if root_length > 0 => {}
                _ => segments.push(segment),
            }
        }
    }
    let mut joined = parts[first][..root_length].to_vec();
    joined.extend_from_slice(&segments.join(&b"/"[..]));
    Some(joined)
}

// The path that an executable looks under for a relative one. Each `..` that leads out of its root stays, as `_.._`.
fn join_below_root(root: &[u8], relative: &[u8]) -> Vec<u8> {
    let mut kept: Vec<&[u8]> = Vec::new();
    for segment in strings::split(relative, b"/") {
        match (segment, kept.last()) {
            (b"" | b".", _) => {}
            (b"..", Some(&last)) if last != b"_.._" => {
                kept.pop();
            }
            (b"..", _) => kept.push(b"_.._"),
            _ => kept.push(segment),
        }
    }
    [root, &kept.join(&b"/"[..])].concat()
}

// The name that an executable looks under first for a relative path. No module has such a path, so it hides none.
fn name_from_working_directory(relative: &[u8]) -> Vec<u8> {
    join_below_root(b"./", relative)
}

/// The file on disk that an executable holds under `named`, a path below its `root`.
fn find_path_on_disk(root_directory: &[u8], root: &[u8], named: &[u8]) -> Option<Vec<u8>> {
    let segments = strings::split(named.strip_prefix(root)?, b"/");
    let segments = segments.map(|it| if it == b"_.._" { &b".."[..] } else { it });
    let name = segments.collect::<Vec<_>>().join(&b"/"[..]);
    join_paths(&[with_separators_of_program(root_directory), name], true)
}

/// The file on disk that a program names by the path or the `file:` URL that it sees for the file when it runs in an executable, with forward slashes.
pub(crate) fn find_file_named_as_in_executable(
    paths: &PathOptions,
    name: &[u8],
) -> Option<Vec<u8>> {
    let root = with_forward_slashes(paths.module_prefix.clone());
    match name.starts_with(b"file:") {
        true => find_path_on_disk(&paths.root_directory, &root, &read_file_url(name)?),
        false => find_path_on_disk(&paths.root_directory, &root, name),
    }
}

/// Whether the program sees its own paths with backslashes when it runs: `B:\~BUN\root\a.js` in an executable for Windows.
fn sees_backslashes(paths: &PathOptions, runs_in_place: bool) -> bool {
    match runs_in_place {
        true => cfg!(windows),
        false => matches!(&paths.module_prefix[..], [b'B', b':', b'/' | b'\\', ..]),
    }
}

/// A path with forward slashes, as the program sees it.
fn with_separators_of_run(path: &[u8], sees_backslashes: bool) -> Vec<u8> {
    with_separators_of_host(path, sees_backslashes)
}

/// A path that the program has put together, with forward slashes. Elsewhere than on Windows a backslash is part of a name.
fn without_separators_of_run(path: Vec<u8>, sees_backslashes: bool) -> Vec<u8> {
    match sees_backslashes {
        true => with_forward_slashes(path),
        false => path,
    }
}

/// A directory that the host has named, `C:\a\b` on Windows, as a program is taken to write it here.
fn with_separators_of_program(directory: &[u8]) -> Vec<u8> {
    match directory {
        [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic() => {
            with_forward_slashes(directory.to_vec())
        }
        _ => directory.to_vec(),
    }
}

struct Walk<'a, 's> {
    files: &'a dyn CodeView<'s>,
    search: &'a WorkerSearch<'a>,
    limits: &'a LimitValues,
    provider: &'a dyn SourceProvider,
    constructor: Option<BuiltinId>,
    url_constructor: Option<BuiltinId>,
    /// `URL.createObjectURL`
    object_url_maker: Option<BuiltinId>,
    blob_constructor: Option<BuiltinId>,
    /// node:worker_threads, node:path and node:url.
    modules: [Option<RuntimeModule>; 3],
    encoders: [(Option<BuiltinId>, Encoder); 2],
    variables_left: u64,
    parameters_left: u64,
    /// Where each name is written in a file, made when a parameter of the file is first followed.
    places_of_names: RefCell<FxHashMap<FileId, Rc<FxHashMap<Atom, Vec<ExprId>>>>>,
    /// What `find_values_passed_for` answers for a parameter. Every start comes by the same parameters.
    values_of_parameters: FxHashMap<(FileId, SymbolId), Option<Vec<ExprId>>>,
    pending: Vec<Pending>,
    /// What has been in `pending` since the `start`, with its `is_behind_property`.
    followed: FxHashSet<(FileId, ExprId, bool)>,
    /// The properties whose stores have been gone through since the `start`: the name, the file of an object that reads itself, whether parameters were followed, and `is_behind_property`.
    properties_followed: FxHashSet<(Atom, Option<FileId>, bool, bool)>,
    /// The parameters whose callers have been gone through since the `start`, with `is_behind_property`.
    parameters_followed: FxHashSet<(FileId, FnId, usize, bool)>,
    /// What is followed was found under the name of a property, whichever object has it: a guess.
    is_behind_property: bool,
    /// `Some`: only a name says that what is followed goes to a program below.
    handed_by_name: Option<WaysFollowedByName>,
    has_options: bool,
    /// What is followed is the code itself: `{ eval: true }`.
    is_evaluated: bool,
    /// `find_own_path` answers where the source lies, not where the executable holds the module.
    reads_source_paths: bool,
    /// The text that was last looked for holds the path of the file it is written in.
    names_own_path: core::cell::Cell<bool>,
    /// The `new Worker()` whose argument is followed.
    start: (FileId, ExprId),
    /// Of the file of the last `start` that was shown. A file that starts many Workers has its lines counted once.
    locator: Option<(FileId, TextLocator<'a>)>,
    /// Each file with its `WorkerFile::has_options`.
    copies: Vec<(FileId, bool)>,
    texts: Vec<WorkerFile>,
    names: Vec<EntryPointPaths>,
    /// A Worker may start from what was not followed to its end, so from a text that is not among `texts`.
    has_unseen_start: bool,
    constructs_node_workers: bool,
    /// The parameters that a start was followed to and that files out of sight may pass a value for: each way to get hold of the function, and the place.
    parameters: FxHashMap<Declaration, Vec<PlaceOfStart>>,
    /// The properties that a start was followed to and that files out of sight may store a value in, by name. The places have no `index`.
    properties: FxHashMap<Atom, Vec<PlaceOfStart>>,
    /// `find_module_below` of each import that was asked about.
    modules_below: RefCell<FxHashMap<(FileId, usize), Option<Vec<u8>>>>,
    /// `find_declaration_called` of each variable that was asked about.
    declarations: KnownDeclarations,
    /// `find_calls_through` of each parameter that was asked about: the function and the place.
    calls: FxHashMap<(FileId, FnId, usize), Rc<Calls>>,
    /// What the calls through one way pass for a parameter.
    arguments_through: FxHashMap<(Declaration, usize), Rc<Vec<(FileId, ExprId)>>>,
    /// Made at the first question.
    sites: Option<Rc<Sites>>,
    /// The files that `visit_file` is called for.
    files_with_starts: Vec<FileId>,
    /// The files that get to code of a program below through what they import.
    reach_below: FxHashSet<FileId>,
    in_parallel: InParallel<'a>,
    names_below: &'a NamesBelow<'a>,
}

/// Where the files that get to a start call, extend and store. One look at all of them answers every question, however many parameters and properties a start leads through.
#[derive(Default)]
struct Sites {
    /// The calls and the `new` that pass something, by what the callee leads to.
    calls: FxHashMap<Declaration, Vec<(FileId, CallId)>>,
    /// The classes, by what they extend.
    heirs: FxHashMap<Declaration, Vec<(FileId, ClassId)>>,
    /// What is put into properties, by their names.
    stored: FxHashMap<Atom, Vec<Stored>>,
}

/// What one file adds to `Sites`.
#[derive(Default)]
struct SitesOfFile {
    calls: Vec<(Declaration, CallId)>,
    heirs: Vec<(Declaration, ClassId)>,
    stored: Vec<(Atom, Stored)>,
}

/// An expression that a start is followed to, and how much further it is followed from there.
#[derive(Copy, Clone)]
struct Pending {
    file: FileId,
    expression: ExprId,
    variables_left: u64,
    parameters_left: u64,
    is_behind_property: bool,
}

/// Where the values that only a name says are handed to a program below have been followed, each with what was left to follow.
/// Thousands of values are stored under such a name, and their ways meet soon. It says nothing of the start: the files found are all that such a start leaves.
type WaysFollowedByName = FxHashMap<(FollowedByName, bool, bool), SmallVec<[(u64, u64); 2]>>;

/// What has been followed from a value that only a name says is handed to a program below.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum FollowedByName {
    Expression(FileId, ExprId),
    Property(Atom, Option<FileId>),
    Parameter(FileId, FnId, usize),
}

/// What a callee or an export leads to, and so a way to get hold of a function or a class.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Declaration {
    /// The variable, the function or the class, in the file of this program that declares it.
    Here(FileId, SymbolId),
    /// A program below exports it: the file that takes it from there, the import, and the name.
    Below(FileId, usize, Atom),
    /// What `module.exports = ..` sets in a file of this program.
    Whole(FileId),
    /// What a property of this name holds, whichever object has it: a method, `{ start }`, `exports.start = ..`.
    Member(Atom),
}

type KnownDeclarations = FxHashMap<(FileId, SymbolId), Option<Declaration>>;

/// Who calls a function, or constructs a class.
struct Calls {
    /// The ways to get hold of it. Of a class: of its heirs that have no constructor too.
    ways: Vec<Declaration>,
    /// What the calls in this program pass for one parameter.
    arguments: Vec<(FileId, ExprId)>,
}

/// What a file puts into a property.
#[derive(Copy, Clone)]
enum Stored {
    /// `{ name: value }` and `object.name = value`.
    Value(FileId, ExprId),
    /// `this.name = value`, and `name = value` in a class.
    Field(FileId, ExprId),
    /// `get name() { return value; }`. A method too: its name is followed where it is called.
    Results(FileId, FnId),
    /// `constructor(private name: URL)`
    Parameter(FileId, ParamId),
}

impl Stored {
    fn file(self) -> FileId {
        match self {
            Stored::Value(file, _)
            | Stored::Field(file, _)
            | Stored::Results(file, _)
            | Stored::Parameter(file, _) => file,
        }
    }

    /// An object puts it into itself.
    fn is_in_object_itself(self) -> bool {
        !matches!(self, Stored::Value(..))
    }
}

/// As in `ParameterThatStartsWorkers`.
#[derive(Copy, Clone, PartialEq, Eq)]
struct PlaceOfStart {
    index: u32,
    has_options: bool,
    is_evaluated: bool,
}

impl PlaceOfStart {
    fn of(parameter: &ParameterThatStartsWorkers) -> PlaceOfStart {
        PlaceOfStart {
            index: parameter.index,
            has_options: parameter.has_options,
            is_evaluated: parameter.is_evaluated,
        }
    }
}

/// Whether an export of a program below is looked for: the file that imports it, the import, and the name. What is not looked for leads nowhere.
type IsSoughtBelow<'a> = dyn Fn(FileId, usize, Atom) -> bool + 'a;

pub(crate) struct CodeThatStartsWorkers {
    pub files: Vec<WorkerFile>,
    /// The names that are written for `files` and are not the paths of their modules: the path that each would have as a file of the executable, and the file on disk that it leads to.
    pub names: Vec<EntryPointPaths>,
    pub code: CodeOfWorkers,
    /// Some file calls `new` on the Worker of node:worker_threads.
    pub constructs_node_workers: bool,
    /// The files that may start a Worker themselves, by name.
    pub files_with_starts: Vec<Vec<u8>>,
    /// Where `WorkerSearch::is_built_upon`: what the programs above are told, without `WorkerSearch::parameters_below`. Ascending.
    pub parameters: Vec<ParameterThatStartsWorkers>,
}

// `import path from "./worker.js" with { type: "file" }; new Worker(path)`, `new Worker("./worker.js")` and `new Worker("data:text/javascript,..")`: the build has seen the code that the Worker runs, or finds it. What the constructor is given is followed back through variables, parameters and exports to the import, to the path or to the text. In the order of their paths.
fn find_places_of_names(hir: &File<'_>) -> FxHashMap<Atom, Vec<ExprId>> {
    let mut places: FxHashMap<Atom, Vec<ExprId>> = FxHashMap::default();
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        if let ExprKind::Ident(name) = hir[expression].kind {
            places.entry(name).or_default().push(expression);
        }
    }
    places
}

/// `data:,text`, `data:text/plain,text`, and whatever names a script.
fn names_type_of_code(url: &[u8]) -> bool {
    let Some(after) = url.strip_prefix(b"data:") else {
        return true;
    };
    let end = strings::index_of_any(after, b";,").unwrap_or(after.len());
    let media_type = after[..end].to_ascii_lowercase();
    media_type.is_empty()
        || media_type == b"text/plain"
        || strings::contains(&media_type, b"script")
        || media_type.ends_with(b"jsx")
        || media_type.ends_with(b"tsx")
}

fn make_empty<T>(set: &mut FxHashSet<T>) {
    if set.capacity() > 8 * set.len() + 64 {
        *set = FxHashSet::default();
    } else {
        set.clear();
    }
}

type FilesOfTexts = RefCell<FxHashMap<Vec<u8>, Option<Vec<u8>>>>;

fn ask_once(
    known: &FilesOfTexts,
    find: &dyn Fn(&[u8]) -> Option<Vec<u8>>,
    text: &[u8],
) -> Option<Vec<u8>> {
    if let Some(found) = known.borrow().get(text) {
        return found.clone();
    }
    let found = find(text);
    known.borrow_mut().insert(text.to_vec(), found.clone());
    found
}

pub(crate) fn find_code_that_starts_workers(
    files: &dyn CodeView<'_>,
    search: &WorkerSearch<'_>,
    in_parallel: InParallel<'_>,
) -> CodeThatStartsWorkers {
    // Each answer takes a resolver of its own, and the ways back from the starts come to the same texts again and again.
    let (entry_points, bare_names) = (FilesOfTexts::default(), FilesOfTexts::default());
    let resolve_entry_point =
        |text: &[u8]| ask_once(&entry_points, search.resolve_entry_point, text);
    let resolve_bare_name = |text: &[u8]| ask_once(&bare_names, search.resolve_bare_name, text);
    let search = &WorkerSearch {
        resolve_entry_point: &resolve_entry_point,
        resolve_bare_name: &resolve_bare_name,
        ..*search
    };
    let &WorkerSearch {
        limits,
        loaders,
        provider,
        ..
    } = search;
    let url_constructor = table::find_name(b"URL").and_then(table::global);
    let names_below = NamesBelow::of(search.parameters_below);
    let mut walk = Walk {
        files,
        search,
        limits,
        provider,
        constructor: table::find_name(b"Worker").and_then(table::global),
        url_constructor,
        object_url_maker: url_constructor
            .zip(table::find_name(b"createObjectURL"))
            .and_then(|(holder, name)| table::own_member(holder, name))
            .map(table::canonical_id),
        blob_constructor: table::find_name(b"Blob").and_then(table::global),
        modules: [b"node:worker_threads".as_slice(), b"node:path", b"node:url"]
            .map(table::module_by_specifier),
        encoders: ENCODERS
            .map(|(name, encode)| (table::find_name(name).and_then(table::global), encode)),
        variables_left: 0,
        parameters_left: 0,
        places_of_names: RefCell::default(),
        values_of_parameters: FxHashMap::default(),
        pending: Vec::new(),
        followed: FxHashSet::default(),
        properties_followed: FxHashSet::default(),
        parameters_followed: FxHashSet::default(),
        is_behind_property: false,
        handed_by_name: None,
        has_options: false,
        is_evaluated: false,
        reads_source_paths: false,
        names_own_path: core::cell::Cell::new(false),
        start: (FileId(0), ExprId(0)),
        locator: None,
        copies: Vec::new(),
        texts: Vec::new(),
        names: Vec::new(),
        has_unseen_start: false,
        constructs_node_workers: false,
        parameters: FxHashMap::default(),
        properties: FxHashMap::default(),
        modules_below: RefCell::default(),
        declarations: FxHashMap::default(),
        calls: FxHashMap::default(),
        arguments_through: FxHashMap::default(),
        sites: None,
        files_with_starts: Vec::new(),
        reach_below: FxHashSet::default(),
        in_parallel,
        names_below: &names_below,
    };
    let compiled = files.compiled_files();
    let (constructor, worker_threads) = (walk.constructor, walk.modules[0]);
    let reach_below = match search.parameters_below.is_empty() {
        true => FxHashSet::default(),
        false => find_files_that_reach(files, &find_files_that_import_from_below(files)),
    };
    let may_start_workers = map_each(compiled.to_vec(), in_parallel, &|file| {
        may_start_workers(files, file, constructor, worker_threads)
            || (reach_below.contains(&file)
                && may_hand_file_to_program_below(files, file, &names_below))
    });
    walk.reach_below = reach_below;
    let with_starts = compiled.iter().zip(may_start_workers).filter(|it| it.1);
    walk.files_with_starts = with_starts.map(|it| *it.0).collect();
    let mut files_with_starts = Vec::new();
    let mut followed_by_name = WaysFollowedByName::default();
    for file in walk.files_with_starts.clone() {
        walk.visit_file(file, &mut followed_by_name);
        files_with_starts.push(files.file_name(file).to_vec());
    }
    let code = match walk.has_unseen_start {
        true => CodeOfWorkers::Unseen,
        false => CodeOfWorkers::Compiled,
    };
    let mut found: Vec<WorkerFile> = (walk.copies.iter())
        .filter_map(|&(copy, has_options)| {
            Some(WorkerFile {
                has_options,
                ..describe_embedded_file(files, loaders, copy)?
            })
        })
        .collect();
    found.append(&mut walk.texts);
    found.retain(|file| !(search.is_held_below)(&file.source_path));
    found.shared_sort_unstable();
    found.dedup();
    (walk.names).retain(|name| !(search.is_held_below)(&name.source_path));
    walk.names.shared_sort_unstable();
    walk.names.dedup();
    // `..` stops at `/`, so files at two heights can get one name. The run cannot tell them apart.
    let same_name = |a: &EntryPointPaths, b: &EntryPointPaths| a.public_path == b.public_path;
    let told_apart = walk.names.chunk_by(same_name).filter(|it| it.len() == 1);
    walk.names = told_apart.flatten().cloned().collect();
    let parameters = match search.is_built_upon {
        true => walk.find_exports_of_parameters(),
        false => Vec::new(),
    };
    CodeThatStartsWorkers {
        files: found,
        names: walk.names,
        code,
        constructs_node_workers: walk.constructs_node_workers,
        files_with_starts,
        parameters,
    }
}

/// `starts`, and the files that get to one of them through what they import, over any number of files.
/// A value comes to a start through calls, and whoever calls has imported. Thousands of files store under a name like `path`, and all but these have objects of their own in mind.
fn find_files_that_reach(files: &dyn CodeView<'_>, starts: &[FileId]) -> FxHashSet<FileId> {
    let mut importers: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    for &importer in files.compiled_files() {
        let Some((written, implied)) = files.answers(importer) else {
            continue;
        };
        for answer in written.iter().chain(implied) {
            let imported = match answer {
                CodeAnswer::File(imported) => core::slice::from_ref(imported),
                CodeAnswer::Computed(ComputedTargets::Modules { files, .. }) => files,
                _ => &[],
            };
            for &imported in imported {
                importers.entry(imported).or_default().push(importer);
            }
        }
    }
    let mut reach: FxHashSet<FileId> = starts.iter().copied().collect();
    let mut pending = starts.to_vec();
    while let Some(reached) = pending.pop() {
        for &importer in importers.get(&reached).into_iter().flatten() {
            if reach.insert(importer) {
                pending.push(importer);
            }
        }
    }
    reach
}

/// The files with an import that leads to code of a program below. Which file there is not asked: that costs a look at the disk for each import.
/// A file that gets to none of these hands nothing to a program below, whatever names it stores under.
fn find_files_that_import_from_below(files: &dyn CodeView<'_>) -> Vec<FileId> {
    let leads_below = |answer: &CodeAnswer<'_>| match *answer {
        CodeAnswer::External {
            specifier,
            kind: ExternalKind::UncompiledCode,
        } => find_module_named(files.atoms().bytes(specifier)).is_none(),
        _ => false,
    };
    let compiled = files.compiled_files().iter().copied();
    compiled
        .filter(|&file| {
            (files.answers(file))
                .is_some_and(|(written, implied)| written.iter().chain(implied).any(leads_below))
        })
        .collect()
}

fn find_sites_of_file(
    files: &dyn CodeView<'_>,
    file: FileId,
    below: &NamesBelow<'_>,
) -> SitesOfFile {
    let mut sites = SitesOfFile::default();
    let Some(source) = parsed_source(files, file) else {
        return sites;
    };
    let (hir, bound) = (files.hir(file), files.bound(file));
    let decisions = &files.analysis(file).decisions;
    // By the name alone: what leads to a program below is out of sight, whichever file there it is.
    let is_sought =
        |_: FileId, _: usize, name: Atom| below.exports.contains_key(files.atoms().bytes(name));
    let mut known = FxHashMap::default();
    let mut find = |callee: ExprId| {
        let found = find_declaration_called(files, file, callee, &mut known, &is_sought)?;
        let is_in_sight = match found {
            Declaration::Here(..) | Declaration::Whole(_) => true,
            Declaration::Member(_) => {
                let callee = hir.skip_type_assertions(callee);
                source.builtins.builtin_of_expression(callee).is_none()
            }
            Declaration::Below(..) => false,
        };
        is_in_sight.then_some(found)
    };
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[expression].kind else {
            let make = match stores_in_this(hir, expression) {
                true => Stored::Field,
                false => Stored::Value,
            };
            let stored = find_names_stored_by(hir, expression);
            sites
                .stored
                .extend(stored.map(|(name, value)| (name, make(file, value))));
            continue;
        };
        let passes_nothing = hir.ids(hir[call].args).next().is_none();
        if passes_nothing || decisions.is_dead_expr(expression) {
            continue;
        }
        if let Some(called) = find(hir[call].callee) {
            sites.calls.push((called, call));
        }
    }
    for class in (0..hir.classes.len() as u32).map(ClassId) {
        let extends = hir[class].extends;
        if let Some(extended) = extends.some().and_then(&mut find) {
            sites.heirs.push((extended, class));
        }
    }
    for member in (0..hir.members.len() as u32).map(MemberId) {
        let is_in_class = matches!(bound.member_owner[member.idx()], MemberOwner::Class(_));
        let Some(name) = hir[member].key.name().filter(|_| is_in_class) else {
            continue;
        };
        let stored = match hir.runtime_member_kind(member) {
            MemberKind::Property if hir[member].init.is_some() => {
                Stored::Field(file, hir[member].init)
            }
            MemberKind::Method | MemberKind::Getter => Stored::Results(file, hir[member].func),
            _ => continue,
        };
        sites.stored.push((name, stored));
    }
    for parameter in (0..hir.params.len() as u32).map(ParamId) {
        if let PatKind::Ident(name) = hir[hir[parameter].pat].kind
            && hir[parameter].flags.contains(Flags::PARAMETER_PROPERTY)
        {
            sites
                .stored
                .push((name, Stored::Parameter(file, parameter)));
        }
    }
    sites
}

fn find_module_answered(
    files: &dyn CodeView<'_>,
    file: FileId,
    site: Option<usize>,
) -> Option<RuntimeModule> {
    let answer = site.and_then(|site| files.answers(file)?.0.get(site));
    match answer {
        Some(&CodeAnswer::HostModule(module)) => RuntimeModule::from_registry_id(module.0),
        // The first of the programs of a realm holds Bun's own modules. To the programs above it they are left to the loader, under the names that are written.
        Some(&CodeAnswer::External {
            specifier,
            kind: ExternalKind::UncompiledCode,
        }) => find_module_named(files.atoms().bytes(specifier)),
        _ => None,
    }
}

pub(crate) fn may_start_workers(
    files: &dyn CodeView<'_>,
    file: FileId,
    constructor: Option<BuiltinId>,
    worker_threads: Option<RuntimeModule>,
) -> bool {
    let Some(source) = parsed_source(files, file) else {
        return false;
    };
    let is_constructor = |&id: &BuiltinId| Some(table::canonical_id(id)) == constructor;
    let mut sites = 0..files.analysis(file).import_sites.len();
    source.builtins.mentioned().iter().any(is_constructor)
        || sites.any(|site| {
            let module = find_module_answered(files, file, Some(site));
            module.is_some() && module == worker_threads
        })
}

/// The names in what the programs below say, by `PlaceIsReachedBy`.
struct NamesBelow<'a> {
    exports: FxHashMap<&'a [u8], Vec<&'a ParameterThatStartsWorkers>>,
    members: FxHashMap<&'a [u8], Vec<&'a ParameterThatStartsWorkers>>,
    properties: FxHashMap<&'a [u8], Vec<&'a ParameterThatStartsWorkers>>,
}

impl<'a> NamesBelow<'a> {
    fn of(parameters_below: &'a [ParameterThatStartsWorkers]) -> NamesBelow<'a> {
        let reached_by = |way: PlaceIsReachedBy| {
            let mut named: FxHashMap<&'a [u8], Vec<&'a ParameterThatStartsWorkers>> =
                FxHashMap::default();
            for parameter in parameters_below.iter().filter(|it| it.reached_by == way) {
                named
                    .entry(&parameter.export[..])
                    .or_default()
                    .push(parameter);
            }
            named
        };
        NamesBelow {
            exports: reached_by(PlaceIsReachedBy::Export),
            members: reached_by(PlaceIsReachedBy::Member),
            properties: reached_by(PlaceIsReachedBy::Property),
        }
    }
}

/// By the names alone: which file an import leads to is asked of the few that are left.
fn may_hand_file_to_program_below(
    files: &dyn CodeView<'_>,
    file: FileId,
    below: &NamesBelow<'_>,
) -> bool {
    let is_told_nothing =
        below.exports.is_empty() && below.members.is_empty() && below.properties.is_empty();
    if is_told_nothing || parsed_source(files, file).is_none() {
        return false;
    }
    let is_sought =
        |_: FileId, _: usize, name: Atom| below.exports.contains_key(files.atoms().bytes(name));
    let hir = files.hir(file);
    let mut known = FxHashMap::default();
    let mut leads_below =
        |callee: ExprId| match find_declaration_called(files, file, callee, &mut known, &is_sought)
        {
            Some(Declaration::Below(..)) => true,
            Some(Declaration::Member(name)) => {
                below.members.contains_key(files.atoms().bytes(name))
            }
            Some(Declaration::Here(..) | Declaration::Whole(_)) | None => false,
        };
    let is_property = |name: Atom| below.properties.contains_key(files.atoms().bytes(name));
    let mut expressions = (0..hir.exprs.len() as u32).map(ExprId);
    let mut classes = (0..hir.classes.len() as u32).map(ClassId);
    expressions.any(|expression| match hir[expression].kind {
        ExprKind::Call(call) | ExprKind::New(call) => leads_below(hir[call].callee),
        _ => find_names_stored_by(hir, expression).any(|(name, _)| is_property(name)),
    }) || classes.any(|class| hir[class].extends.is_some() && leads_below(hir[class].extends))
}

// Every code file that the program embeds with the `file` loader, sorted by path.
pub(crate) fn find_embedded_code_files(
    files: &dyn CodeView<'_>,
    loaders: &[(Vec<u8>, Loader)],
    is_held_below: &dyn Fn(&[u8]) -> bool,
    in_parallel: InParallel<'_>,
) -> Vec<WorkerFile> {
    let compiled = files.compiled_files().to_vec();
    let described = map_each(compiled, in_parallel, &|file| {
        describe_embedded_file(files, loaders, file)
    });
    let mut copies: Vec<WorkerFile> = described.into_iter().flatten().collect();
    copies.retain(|copy| !is_held_below(&copy.source_path));
    copies.shared_sort_unstable();
    copies.dedup();
    copies
}

/// `WorkerFile::source_path` of a file that the load knows as `path`.
pub(crate) fn source_path_of(path: &[u8]) -> Vec<u8> {
    with_separators_of_host(to_native(path), cfg!(windows))
}

fn describe_embedded_file(
    files: &dyn CodeView<'_>,
    loaders: &[(Vec<u8>, Loader)],
    copy: FileId,
) -> Option<WorkerFile> {
    let source = parsed_source(files, copy)?;
    let is_copy = source.kind == SourceKind::Data && source.loader == Loader::File;
    if !is_copy || source.is_from_plugin || source.plugin_module.is_some() {
        return None;
    }
    let path = files.file_name(copy);
    let is_code =
        loader_named_by_path(loaders, path).is_some_and(|loader| script_kind_of(loader).is_some());
    if !is_code {
        return None;
    }
    let hir = files.hir(copy);
    let embedded_path = hir.ids(hir.body).find_map(|statement| {
        let StmtKind::ExportDefault(value) = hir[statement].kind else {
            return None;
        };
        match hir[value].kind {
            ExprKind::String(path) => Some(files.atoms().bytes(path).to_vec()),
            _ => None,
        }
    })?;
    Some(WorkerFile {
        source_path: source_path_of(path),
        embedded_path,
        is_guess: false,
        has_options: false,
        started_at: None,
        text: None,
        is_named_by_path: false,
    })
}

impl Walk<'_, '_> {
    fn visit_file(&mut self, file: FileId, followed_by_name: &mut WaysFollowedByName) {
        let files = self.files;
        let Some(source) = parsed_source(files, file) else {
            return;
        };
        let (hir, bound) = (files.hir(file), files.bound(file));
        let decisions = &files.analysis(file).decisions;
        let mut callees: Vec<ExprId> = Vec::new();
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::New(call) = hir[expression].kind else {
                continue;
            };
            let callee = hir.skip_type_assertions(hir[call].callee);
            let constructor = source.builtins.builtin_of_expression(callee);
            let starts_worker = match constructor {
                Some(constructor) => Some(table::canonical_id(constructor)) == self.constructor,
                None => self.is_worker_of_node(file, callee),
            };
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !decisions.is_dead_expr(expression);
            if !starts_worker || !is_evaluated {
                continue;
            }
            callees.push(callee);
            self.constructs_node_workers |= constructor.is_none();
            let mut arguments = hir.ids(hir[call].args);
            if let Some(argument) = arguments.next() {
                let options = arguments.next();
                self.has_options = options.is_some();
                self.start = (file, expression);
                let is_text = constructor.is_none()
                    && options.is_some_and(|it| self.follow_evaluated_text(file, argument, it));
                if !is_text {
                    let had_unseen_start = core::mem::replace(&mut self.has_unseen_start, false);
                    self.follow(file, argument);
                    if self.has_unseen_start && self.add_files_named_in_part(file, argument) {
                        self.has_unseen_start = false;
                    }
                    self.has_unseen_start |= had_unseen_start;
                }
                if let Some(options) = options {
                    self.follow_preloads(file, options);
                }
            }
        }
        callees.shared_sort_unstable();
        self.has_unseen_start |= !self.names_constructors_only_as(file, &callees);
        self.visit_what_is_handed_below(file, followed_by_name);
    }

    /// `spawn(new URL("./worker.ts", import.meta.url))`, where a program below says `export function spawn(entry) { return new Worker(entry); }`:
    /// the call is a start like `new Worker(..)`. That program's build did not see this file, and this build does not read that one.
    /// So are `new Pool(..)`, `pool.start(..)` and `{ filename: .. }`, where the program below starts a Worker from what it gets that way.
    fn visit_what_is_handed_below(
        &mut self,
        file: FileId,
        followed_by_name: &mut WaysFollowedByName,
    ) {
        let files = self.files;
        if !self.reach_below.contains(&file) {
            return;
        }
        let (hir, bound) = (files.hir(file), files.bound(file));
        let decisions = &files.analysis(file).decisions;
        let mut known = core::mem::take(&mut self.declarations);
        let walk = &*self;
        let is_sought = |importer: FileId, site: usize, name: Atom| {
            !walk.find_parameters_below(importer, site, name).is_empty()
        };
        // The places, and whether only a name says that they are meant.
        let mut find_places = |callee: ExprId| match find_declaration_called(
            files, file, callee, &mut known, &is_sought,
        ) {
            Some(Declaration::Below(importer, site, name)) => {
                (walk.find_parameters_below(importer, site, name), false)
            }
            Some(Declaration::Member(name)) if !walk.is_builtin(file, callee) => {
                let places = walk.find_places_below_by_name(name, PlaceIsReachedBy::Member);
                (places, true)
            }
            _ => (Vec::new(), false),
        };
        let mut handed: Vec<(ExprId, ExprId, PlaceOfStart, bool)> = Vec::new();
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let is_evaluated = || {
                bound.parent_of_expr(expression) != Parent::None
                    && !decisions.is_dead_expr(expression)
            };
            let (ExprKind::Call(call) | ExprKind::New(call)) = hir[expression].kind else {
                for (name, value) in find_names_stored_by(hir, expression) {
                    let places = walk.find_places_below_by_name(name, PlaceIsReachedBy::Property);
                    let places = places.into_iter().filter(|_| is_evaluated());
                    handed.extend(places.map(|place| (expression, value, place, true)));
                }
                continue;
            };
            let (places, is_by_name) = find_places(hir[call].callee);
            for place in places.into_iter().filter(|_| is_evaluated()) {
                let argument = find_argument(hir, call, place.index as usize);
                handed.extend(argument.map(|it| (expression, it, place, is_by_name)));
            }
        }
        let classes = (0..hir.classes.len() as u32).map(ClassId);
        let heirs: Vec<(ClassId, Vec<PlaceOfStart>, bool)> = classes
            .filter(|&class| hir[class].extends.is_some())
            .map(|class| {
                let (places, is_by_name) = find_places(hir[class].extends);
                (class, places, is_by_name)
            })
            .filter(|heir| !heir.1.is_empty())
            .collect();
        self.declarations = known;
        for (start, value, place, is_by_name) in handed {
            let by_name = is_by_name.then_some(&mut *followed_by_name);
            self.follow_what_is_handed_below((file, start), (file, value), place, by_name);
        }
        // `class Sub extends Pool {}`: `new Sub(..)` and `super(..)` run the constructor below.
        for (class, places, is_by_name) in heirs {
            let start = (file, hir[class].extends);
            for place in places {
                let index = place.index as usize;
                let arguments: Vec<(FileId, ExprId)> = match find_constructor(hir, class) {
                    Some(constructor) => find_calls_of_super(hir, constructor)
                        .into_iter()
                        .filter_map(|call| Some((file, find_argument(hir, call, index)?)))
                        .collect(),
                    None => {
                        let mut ways = Vec::new();
                        self.add_ways_to_class(file, class, &mut ways);
                        let calls = self.find_calls_through(ways, true, index);
                        (self.has_options, self.is_evaluated) =
                            (place.has_options, place.is_evaluated);
                        self.note_parameter(&calls.ways, index);
                        self.is_evaluated = false;
                        calls.arguments
                    }
                };
                for argument in arguments {
                    let by_name = is_by_name.then_some(&mut *followed_by_name);
                    self.follow_what_is_handed_below(start, argument, place, by_name);
                }
            }
        }
    }

    fn follow_what_is_handed_below(
        &mut self,
        start: (FileId, ExprId),
        value: (FileId, ExprId),
        place: PlaceOfStart,
        mut by_name: Option<&mut WaysFollowedByName>,
    ) {
        self.start = start;
        self.has_options = place.has_options;
        self.is_evaluated = place.is_evaluated;
        let had_unseen_start = self.has_unseen_start;
        self.handed_by_name = by_name.as_deref_mut().map(core::mem::take);
        self.follow(value.0, value.1);
        // Another object may have a property of the same name. The program below says itself that it has not seen all that it starts from.
        if let (Some(kept), Some(followed)) = (by_name, self.handed_by_name.take()) {
            *kept = followed;
            self.has_unseen_start = had_unseen_start;
        }
        self.is_evaluated = false;
    }

    /// `WorkerFile::source_path` of the file in a program below that an import leads to.
    fn find_module_below(&self, importer: FileId, site: usize) -> Option<Vec<u8>> {
        let files = self.files;
        if let Some(known) = self.modules_below.borrow().get(&(importer, site)) {
            return known.clone();
        }
        let find = || {
            let &CodeAnswer::External {
                specifier,
                kind: ExternalKind::UncompiledCode,
            } = files.answers(importer)?.0.get(site)?
            else {
                return None;
            };
            let written_in = files.file_name(importer);
            let path = (self.search.resolve_import)(written_in, files.atoms().bytes(specifier))?;
            Some(source_path_of(&path))
        };
        let found = find();
        let mut known = self.modules_below.borrow_mut();
        known.insert((importer, site), found.clone());
        found
    }

    /// The parameters of an export of a program below that start Workers.
    fn find_parameters_below(
        &self,
        importer: FileId,
        site: usize,
        name: Atom,
    ) -> Vec<PlaceOfStart> {
        let name = self.files.atoms().bytes(name);
        // Few exports start Workers, and to ask which file an import leads to costs a look at the disk.
        let Some(below) = self.names_below.exports.get(name) else {
            return Vec::new();
        };
        let Some(module) = self.find_module_below(importer, site) else {
            return Vec::new();
        };
        let of_module = below.iter().filter(|it| it.module == module);
        of_module.map(|it| PlaceOfStart::of(it)).collect()
    }

    /// What the programs below say of a property of this name.
    fn find_places_below_by_name(&self, name: Atom, way: PlaceIsReachedBy) -> Vec<PlaceOfStart> {
        let name = self.files.atoms().bytes(name);
        let names = match way {
            PlaceIsReachedBy::Export => &self.names_below.exports,
            PlaceIsReachedBy::Member => &self.names_below.members,
            PlaceIsReachedBy::Property => &self.names_below.properties,
        };
        let named = names.get(name).into_iter().flatten();
        named.map(|it| PlaceOfStart::of(it)).collect()
    }

    /// `parameters` under every name that a file of this program exports the function under.
    fn find_exports_of_parameters(&self) -> Vec<ParameterThatStartsWorkers> {
        let files = self.files;
        let is_told_nothing = self.search.parameters_below.is_empty();
        if self.parameters.is_empty() && self.properties.is_empty() && is_told_nothing {
            return Vec::new();
        }
        let is_sought = |importer: FileId, site: usize, name: Atom| {
            !self.find_parameters_below(importer, site, name).is_empty()
        };
        let places_of = |declaration: Declaration| match declaration {
            // `export { spawn } from "./spawn"`, where a program below holds ./spawn.
            Declaration::Below(importer, site, name) => {
                self.find_parameters_below(importer, site, name)
            }
            _ => (self.parameters.get(&declaration).cloned()).unwrap_or_default(),
        };
        let look_under = |exporter: FileId, name: Atom| {
            let declaration =
                find_declaration_exported_by(files, exporter, name, MOST_REEXPORTS, &is_sought);
            let places = declaration.map(&places_of).unwrap_or_default();
            places
                .into_iter()
                .map(move |place| ParameterThatStartsWorkers {
                    module: source_path_of(files.file_name(exporter)),
                    export: files.atoms().bytes(name).to_vec(),
                    reached_by: PlaceIsReachedBy::Export,
                    index: place.index,
                    has_options: place.has_options,
                    is_evaluated: place.is_evaluated,
                })
        };
        let mut found: Vec<ParameterThatStartsWorkers> = Vec::new();
        let declares: FxHashSet<FileId> = (self.parameters.keys())
            .filter_map(|&declaration| match declaration {
                Declaration::Here(file, _) => Some(file),
                _ => None,
            })
            .collect();
        let exporters = || {
            let compiled = files.compiled_files().iter().copied();
            compiled.filter(|&file| parsed_source(files, file).is_some())
        };
        for exporter in exporters() {
            let bound = files.bound(exporter);
            for &(name, export) in bound.table(bound.symbol(bound.file_symbol).exports) {
                // What a file declares itself leads no further.
                let mut declarations = bound.symbol(export).decls.iter();
                if declares.contains(&exporter)
                    || declarations.any(|it| matches!(it, Decl::ExportSpec(_)))
                {
                    found.extend(look_under(exporter, name));
                }
            }
        }
        // `export * from "./spawn"` lists no name and hands each on as it is.
        let below = self.search.parameters_below.iter();
        let below = below.filter(|it| it.reached_by == PlaceIsReachedBy::Export);
        let mut names: Vec<&[u8]> = below.map(|it| &it.export[..]).collect();
        names.extend(found.iter().map(|it| &it.export[..]));
        names.shared_sort_unstable();
        names.dedup();
        let names: Vec<Atom> = (names.into_iter())
            .map(|name| files.atoms().intern(name))
            .collect();
        for exporter in exporters() {
            let (hir, bound) = (files.hir(exporter), files.bound(exporter));
            let hands_names_on = hir.ids(hir.body).any(|statement| {
                matches!(hir[statement].kind, StmtKind::ExportStar { alias, type_only: false, .. } if !alias.is_some())
            });
            if !hands_names_on {
                continue;
            }
            let listed = bound.table(bound.symbol(bound.file_symbol).exports);
            for &name in &names {
                if !listed.iter().any(|entry| entry.0 == name) {
                    found.extend(look_under(exporter, name));
                }
            }
        }
        let by_name = |name: Atom, way: PlaceIsReachedBy| (Vec::new(), name, way);
        let without_export = self.parameters.iter().filter_map(|(&declaration, places)| {
            let reached = match declaration {
                Declaration::Whole(file) => {
                    let module = source_path_of(files.file_name(file));
                    (module, known::default, PlaceIsReachedBy::Export)
                }
                Declaration::Member(name) => by_name(name, PlaceIsReachedBy::Member),
                Declaration::Here(..) | Declaration::Below(..) => return None,
            };
            Some((reached, places))
        });
        let properties = (self.properties.iter())
            .map(|(&name, places)| (by_name(name, PlaceIsReachedBy::Property), places));
        for ((module, name, reached_by), places) in without_export.chain(properties) {
            found.extend(places.iter().map(|place| ParameterThatStartsWorkers {
                module: module.clone(),
                export: files.atoms().bytes(name).to_vec(),
                reached_by,
                index: place.index,
                has_options: place.has_options,
                is_evaluated: place.is_evaluated,
            }));
        }
        found.shared_sort_unstable();
        found.dedup();
        found
    }

    /// Whether nothing but `callees`, which are sorted, gets hold of a constructor of Workers in the file.
    fn names_constructors_only_as(&self, file: FileId, callees: &[ExprId]) -> bool {
        let files = self.files;
        let Some(source) = parsed_source(files, file) else {
            return false;
        };
        let (hir, bound, analysis) = (files.hir(file), files.bound(file), files.analysis(file));
        let is_threads =
            |module: Option<RuntimeModule>| module.is_some() && module == self.modules[0];
        let mut kinds = (analysis.import_sites.iter().enumerate())
            .filter(|&(site, _)| is_threads(self.find_module_answered(file, Some(site))))
            .map(|(_, site)| site.kind);
        let is_followed =
            |kind| matches!(kind, ImportSiteKind::Import(_) | ImportSiteKind::Require(_));
        let mut exported = (0..hir.export_specs.len() as u32).map(ExportSpecId);
        let is_import = |specifier| match bound.exported_binding(specifier) {
            Binding::Symbol(symbol) => {
                bound.binding_initializer(hir, symbol) == BindingInitializer::Import
            }
            _ => false,
        };
        if !kinds.all(is_followed) || exported.any(is_import) {
            return false;
        }
        let is_global = |expression| {
            let id = match source.builtins.of_expr(expression) {
                Some(Resolved::Builtin(path) | Resolved::DynamicGlobal(path)) => path.id,
                Some(Resolved::Intrinsic(Intrinsic::Builtin(id))) => id,
                Some(Resolved::Intrinsic(_)) | None => return false,
            };
            Some(table::canonical_id(id)) == self.constructor
        };
        (0..hir.exprs.len() as u32).map(ExprId).all(|expression| {
            let is_evaluated = bound.parent_of_expr(expression) != Parent::None
                && !analysis.decisions.is_dead_expr(expression);
            if !is_evaluated || callees.binary_search(&expression).is_ok() {
                return true;
            }
            !is_global(expression)
                && !self.is_worker_of_node(file, expression)
                && (!is_threads(self.find_module(file, expression))
                    || self.is_read_by_names(file, expression))
        })
    }

    /// Of an expression that is a module of Bun's own: whether the file only reads members of it by names that are written there, each of which `find_member_of_module` finds.
    fn is_read_by_names(&self, file: FileId, module: ExprId) -> bool {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let keeps_to_itself = |name: PatId| match bound.initialized_binding(name) {
            Binding::Symbol(symbol) => {
                matches!(hir[name].kind, PatKind::Ident(_))
                    && bound.is_stable_binding(symbol)
                    && !is_exported(hir, bound, symbol)
            }
            _ => false,
        };
        match bound.parent_of_expr(module) {
            Parent::Expr(parent) => match hir[parent].kind {
                ExprKind::Dot { obj, .. } => obj == module,
                _ => {
                    hir.skip_type_assertions(parent) == hir.skip_type_assertions(module)
                        && self.is_read_by_names(file, parent)
                }
            },
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Ident(_) => {
                    matches!(hir[module].kind, ExprKind::Call(_))
                        && keeps_to_itself(hir[declaration].pat)
                }
                PatKind::Object(properties) => properties.iter().all(|property| {
                    let has_name = matches!(hir.runtime_binding_key(property), PropKey::Name(_));
                    let property = &hir[property];
                    has_name
                        && !property.is_rest
                        && property.default.is_none()
                        && keeps_to_itself(property.value)
                }),
                PatKind::Array(_) | PatKind::Missing => false,
            },
            _ => false,
        }
    }

    // `import { Worker } from "node:worker_threads"`, `const { Worker } = require("node:worker_threads")` and `threads.Worker`
    fn is_worker_of_node(&self, file: FileId, callee: ExprId) -> bool {
        self.find_member_of_module(file, callee)
            .is_some_and(|(module, name)| {
                Some(module) == self.modules[0] && self.files.atoms().bytes(name) == b"Worker"
            })
    }

    /// The module of Bun's own and the name of its export that the expression reads.
    fn find_member_of_module(&self, file: FileId, member: ExprId) -> Option<(RuntimeModule, Atom)> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        match hir[member].kind {
            ExprKind::Dot { obj, name, .. } => Some((self.find_module(file, obj)?, name)),
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(member) else {
                    return None;
                };
                if let &[Decl::ImportSpec(specifier)] = bound.symbol(symbol).decls {
                    let specifier = hir[specifier];
                    let kind = ImportSiteKind::Import(specifier.import);
                    let site = files.analysis(file).import_site_index(kind);
                    return Some((self.find_module_answered(file, site)?, specifier.imported));
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::PatternProperty { source, path } => match path[..] {
                        [name] => Some((self.find_module(file, source)?, name)),
                        _ => None,
                    },
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        match hir[source].kind {
                            ExprKind::Dot { .. } => self.find_member_of_module(file, source),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_module(&self, file: FileId, module: ExprId) -> Option<RuntimeModule> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let module = hir.skip_type_assertions(module);
        match hir[module].kind {
            ExprKind::Call(_) => {
                let site = files.analysis(file).import_site_of_call(module);
                self.find_module_answered(file, site)
            }
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(module) else {
                    return None;
                };
                if let &[Decl::ImportNamespace(import) | Decl::ImportDefault(import)] =
                    bound.symbol(symbol).decls
                {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    return self.find_module_answered(file, site);
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        match hir[source].kind {
                            ExprKind::Call(_) => self.find_module(file, source),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn find_module_answered(&self, file: FileId, site: Option<usize>) -> Option<RuntimeModule> {
        find_module_answered(self.files, file, site)
    }

    fn follow(&mut self, file: FileId, argument: ExprId) {
        let (files, limits) = (self.files, self.limits);
        self.variables_left = limits.get(LimitId::MaxVariablesFollowedToLoader);
        self.parameters_left = limits.get(LimitId::MaxParametersFollowedToLoader);
        // A value is handed on by name thousands of times, and a set that held a long way once takes as long to clear each time.
        make_empty(&mut self.followed);
        make_empty(&mut self.properties_followed);
        make_empty(&mut self.parameters_followed);
        self.is_behind_property = self.handed_by_name.is_some();
        self.push(file, argument);
        while let Some(next) = self.pending.pop() {
            let Pending {
                file, expression, ..
            } = next;
            // Each way back from the start is followed as far as any other.
            self.variables_left = next.variables_left;
            self.parameters_left = next.parameters_left;
            self.is_behind_property = next.is_behind_property;
            let hir = files.hir(file);
            let expression = hir.skip_type_assertions(expression);
            if files.analysis(file).decisions.is_dead_expr(expression) {
                continue;
            }
            let variables_left = self.variables_left;
            let text = self.find_text(file, expression);
            if let Some(text) = &text
                && (self.add_evaluated_text(text)
                    || self.add_url(text)
                    || self.add_path(file, text))
            {
                continue;
            }
            self.variables_left = variables_left;
            if let Some(text) = &text
                && self.add_path_above_prefix(file, expression, text)
            {
                continue;
            }
            self.variables_left = variables_left;
            // A path under which the executable holds no code starts no Worker, whatever else the expression leads to.
            let is_path = text.is_some_and(|text| !is_name_of_text(&text));
            let had_unseen_start = self.has_unseen_start;
            match hir[expression].kind {
                ExprKind::Call(call) if !self.is_evaluated => {
                    if self.follow_object_url(file, call).is_none() {
                        // A helper mostly hands on what it is given, so that is code that the Worker may start from.
                        self.has_unseen_start = true;
                        let was_behind_property = self.is_behind_property;
                        let callee = hir.skip_type_assertions(hir[call].callee);
                        let is_of_host = self.is_builtin(file, callee)
                            || self.find_member_of_module(file, callee).is_some();
                        // Of a function of the program it is a guess, and a guess is no ground for another. What the function answers with is followed below.
                        if is_of_host || !was_behind_property {
                            self.is_behind_property |= self.is_called_by_name(file, callee);
                            for argument in hir.ids(hir[call].args) {
                                self.push(file, argument);
                            }
                            self.is_behind_property = was_behind_property;
                        }
                        // `new Worker(workerUrl())`: the callee leads to a function, and that to what it answers with.
                        self.push(file, hir[call].callee);
                    }
                }
                ExprKind::Fn(function) => self.follow_results_of(file, function),
                // A path and a URL are what they are awaited as.
                ExprKind::Await(awaited) => self.push(file, awaited),
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    self.push(file, yes);
                    self.push(file, no);
                }
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => {
                    self.push(file, left);
                    self.push(file, right);
                }
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Comma,
                    right,
                    ..
                } => self.push(file, right),
                ExprKind::Dot { obj, name, .. } => {
                    if name != known::default || !self.follow_default_of(file, obj) {
                        self.follow_property(file, name, is_this(hir, obj));
                    }
                    // A Worker starts from a URL as from what the URL says.
                    if files.atoms().bytes(name) == b"href" {
                        self.push(file, obj);
                    }
                }
                ExprKind::Ident(_) => self.follow_name(file, expression),
                _ => self.has_unseen_start = true,
            }
            if is_path {
                self.has_unseen_start = had_unseen_start;
            }
        }
    }

    /// `holder.make(..)`: only the name says which function runs, so what becomes of its arguments is a guess.
    fn is_called_by_name(&self, file: FileId, callee: ExprId) -> bool {
        let hir = self.files.hir(file);
        let callee = hir.skip_type_assertions(callee);
        let ExprKind::Dot { obj, .. } = hir[callee].kind else {
            return false;
        };
        !is_this(hir, obj)
            && !self.is_builtin(file, callee)
            && self.find_member_of_module(file, callee).is_none()
            && find_site_of_object(self.files, file, obj).is_none()
    }

    /// True where another value handed by a name has come this way, with as much left to follow.
    fn was_followed_by_name(&mut self, what: FollowedByName) -> bool {
        let left = (self.variables_left, self.parameters_left);
        let way = (what, self.has_options, self.is_evaluated);
        let Some(followed) = &mut self.handed_by_name else {
            return false;
        };
        let ways = followed.entry(way).or_default();
        if ways.iter().any(|it| it.0 >= left.0 && it.1 >= left.1) {
            return true;
        }
        ways.retain(|it| it.0 > left.0 || it.1 > left.1);
        ways.push(left);
        false
    }

    fn push(&mut self, file: FileId, expression: ExprId) {
        // What has been followed for sure need not be followed as a guess.
        let is_guess = self.is_behind_property;
        if !(is_guess && self.followed.contains(&(file, expression, false)))
            && self.followed.insert((file, expression, is_guess))
            && !self.was_followed_by_name(FollowedByName::Expression(file, expression))
        {
            self.pending.push(Pending {
                file,
                expression,
                variables_left: self.variables_left,
                parameters_left: self.parameters_left,
                is_behind_property: self.is_behind_property,
            });
        }
    }

    /// What `BoundIn::binding_initializer` answers. A variable that is stored to may hold something else.
    fn find_initializer_of(&mut self, file: FileId, symbol: SymbolId) -> BindingInitializer {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let initializer = bound.binding_initializer(hir, symbol);
        self.has_unseen_start |=
            initializer != BindingInitializer::Import && !bound.is_stable_binding(symbol);
        initializer
    }

    // What the constructor of a Worker makes of the value that the expression always evaluates to, if that is a text or a URL: a constant, or constants and the path of the file itself that `+`, a template, `encodeURIComponent()`, `btoa()`, `new URL()` and the functions of node:path and node:url put together. A path is what the program sees when it runs, with its separators.
    fn find_text(&mut self, file: FileId, expression: ExprId) -> Option<Vec<u8>> {
        let files = self.files;
        let hir = files.hir(file);
        let expression = hir.skip_type_assertions(expression);
        let folded = match (files.analysis(file).decisions).constant(hir, expression) {
            FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) => text,
            FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) => return None,
            FoldedValue::Unknown => return self.find_text_of_parts(file, expression),
        };
        // `__dirname + "/job.js"` folds to the path of the source. Its parts say that the path comes from the file's own, which a text does not.
        // The value is known either way, so whatever the walk through the parts could not see is no code out of sight.
        let (has_unseen_start, variables_left) = (self.has_unseen_start, self.variables_left);
        let has_parts = matches!(
            hir[expression].kind,
            ExprKind::Binary { op: BinOp::Add, .. }
                | ExprKind::Template { .. }
                | ExprKind::Ident(_)
        );
        let of_parts = match has_parts {
            true => self.find_text_of_parts(file, expression),
            false => None,
        };
        self.has_unseen_start = has_unseen_start;
        if of_parts.is_none() {
            self.variables_left = variables_left;
        }
        Some(of_parts.unwrap_or_else(|| files.atoms().bytes(folded).to_vec()))
    }

    fn find_text_of_parts(&mut self, file: FileId, expression: ExprId) -> Option<Vec<u8>> {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        // `sep` of node:path, also under a name of its own.
        if let Some((module, name)) = self.find_member_of_module(file, expression)
            && self.modules[1] == Some(module)
            && files.atoms().bytes(name) == b"sep"
        {
            return Some(self.as_seen(b"/"));
        }
        match hir[expression].kind {
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let mut text = self.find_text(file, left)?;
                text.append(&mut self.find_text(file, right)?);
                Some(text)
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut text = files.atoms().bytes(texts.next()?).to_vec();
                for (substitution, following) in hir.ids(exprs).zip(texts) {
                    text.append(&mut self.find_text(file, substitution)?);
                    text.extend_from_slice(files.atoms().bytes(following));
                }
                Some(text)
            }
            ExprKind::New(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let constructor = self.find_builtin(file, callee)?;
                let mut arguments = hir.ids(hir[call].args);
                let written = arguments.next()?;
                if Some(constructor) != self.url_constructor {
                    return None;
                }
                let written = self.find_text(file, written)?;
                match arguments.next() {
                    None => self.provider.write_url(&written, None),
                    Some(base) => {
                        let base = self.find_text(file, base)?;
                        self.provider.write_url(&written, Some(&base))
                    }
                }
            }
            ExprKind::Call(call) => self.find_text_of_call(file, expression, call),
            ExprKind::Dot { obj, name, .. } => self.find_text_of_member(file, obj, name),
            ExprKind::Ident(_) => match bound.binding(expression) {
                Binding::CommonJs(CommonJsVariable::Filename) => self.find_source_path(file, false),
                Binding::CommonJs(CommonJsVariable::Dirname) => self.find_source_path(file, true),
                Binding::Symbol(symbol) if self.variables_left > 0 => {
                    self.variables_left -= 1;
                    match self.find_initializer_of(file, symbol) {
                        BindingInitializer::Expression(source) => self.find_text(file, source),
                        _ => None,
                    }
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn is_builtin(&self, file: FileId, expression: ExprId) -> bool {
        let expression = self.files.hir(file).skip_type_assertions(expression);
        self.find_builtin(file, expression).is_some()
    }

    fn find_builtin(&self, file: FileId, expression: ExprId) -> Option<BuiltinId> {
        let builtins = &parsed_source(self.files, file)?.builtins;
        builtins
            .builtin_of_expression(expression)
            .map(table::canonical_id)
    }

    fn as_seen(&self, path: &[u8]) -> Vec<u8> {
        let search = self.search;
        with_separators_of_run(path, sees_backslashes(search.paths, search.runs_in_place))
    }

    fn as_joined(&self, path: Vec<u8>) -> Vec<u8> {
        let search = self.search;
        without_separators_of_run(path, sees_backslashes(search.paths, search.runs_in_place))
    }

    /// The path of the module as the program sees it when it runs, with forward slashes.
    fn find_own_path(&self, file: FileId) -> Option<Vec<u8>> {
        let path = self.files.file_name(file);
        if is_host_path(path) {
            return None;
        }
        let search = self.search;
        if search.runs_in_place || self.reads_source_paths {
            return Some(to_native(path).to_vec());
        }
        let mut entry_points = self.files.entry_points().iter();
        let name = match entry_points.position(|&entry_point| entry_point == file) {
            Some(index) => search.paths.entry_point_names.get(index)?.clone(),
            None => compute_relative_path(&search.paths.root_directory, to_native(path))?,
        };
        Some(with_forward_slashes(compute_module_path(
            search.paths,
            &name,
        )))
    }

    /// What `__filename` holds in the file and `require.resolve` answers for it, or the folder of that: in an executable, where the file lies on the machine that builds.
    fn find_source_path(&self, file: FileId, is_folder: bool) -> Option<Vec<u8>> {
        self.names_own_path.set(true);
        let folder_or_file = |path: &[u8]| match is_folder {
            true => dirname::<Posix>(path).to_vec(),
            false => path.to_vec(),
        };
        if self.search.runs_in_place || self.reads_source_paths {
            return Some(self.as_seen(&folder_or_file(&self.find_own_path(file)?)));
        }
        let path = self.files.file_name(file);
        if is_host_path(path) {
            return None;
        }
        // `Sources::find_source_path`
        if is_name_of_text(path) {
            return Some(folder_or_file(path));
        }
        let path = folder_or_file(to_native(path));
        Some(with_separators_of_host(&path, cfg!(windows)))
    }

    fn find_text_of_member(&mut self, file: FileId, object: ExprId, name: Atom) -> Option<Vec<u8>> {
        let files = self.files;
        let hir = files.hir(file);
        let object = hir.skip_type_assertions(object);
        let name = files.atoms().bytes(name);
        if matches!(hir[object].kind, ExprKind::ImportMeta) {
            if files.bound(file).import_meta_may_be_modified() {
                return None;
            }
            let path = self.find_own_path(file)?;
            return match name {
                b"path" | b"filename" => Some(self.as_seen(&path)),
                b"dir" | b"dirname" => Some(self.as_seen(dirname::<Posix>(&path))),
                b"url" => write_file_url(&path),
                _ => None,
            };
        }
        match (name, self.is_url(file, object)) {
            (b"href", true) => self.find_text(file, object),
            _ => None,
        }
    }

    // `new URL(..)` and `pathToFileURL(..)`, also in a variable.
    fn is_url(&self, file: FileId, expression: ExprId) -> bool {
        let files = self.files;
        let (hir, bound) = (files.hir(file), files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        match hir[expression].kind {
            ExprKind::New(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                let constructor = self.find_builtin(file, callee);
                constructor.is_some() && constructor == self.url_constructor
            }
            ExprKind::Call(call) => {
                let callee = hir.skip_type_assertions(hir[call].callee);
                (self.find_member_of_module(file, callee)).is_some_and(|(module, name)| {
                    Some(module) == self.modules[2] && files.atoms().bytes(name) == b"pathToFileURL"
                })
            }
            ExprKind::Ident(_) => match bound.binding(expression) {
                Binding::Symbol(symbol) => match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => {
                        let source = hir.skip_type_assertions(source);
                        !matches!(hir[source].kind, ExprKind::Ident(_)) && self.is_url(file, source)
                    }
                    _ => false,
                },
                _ => false,
            },
            _ => false,
        }
    }

    fn find_text_of_call(
        &mut self,
        file: FileId,
        expression: ExprId,
        call: CallId,
    ) -> Option<Vec<u8>> {
        let files = self.files;
        let hir = files.hir(file);
        let analysis = files.analysis(file);
        if let Some(site) = analysis.import_site_of_call(expression) {
            let &CodeAnswer::File(found) = files.answers(file)?.0.get(site)? else {
                return None;
            };
            return match analysis.import_sites[site].kind {
                ImportSiteKind::RequireResolve(_) => self.find_source_path(found, false),
                ImportSiteKind::ImportMetaResolve(_) => write_file_url(&self.find_own_path(found)?),
                _ => None,
            };
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        if let Some(function) = self.find_builtin(file, callee) {
            let encode = (self.encoders.iter()).find(|it| it.0 == Some(function))?.1;
            return encode(&self.find_text(file, *arguments.first()?)?);
        }
        if let Some((module, name)) = self.find_member_of_module(file, callee) {
            let name = files.atoms().bytes(name);
            let position = self.modules.iter().position(|&it| it == Some(module))?;
            return match (position, name) {
                (1, b"join" | b"resolve") => {
                    let parts: Option<Vec<Vec<u8>>> = (arguments.iter())
                        .map(|&argument| {
                            let part = self.find_text(file, argument)?;
                            Some(self.as_joined(part))
                        })
                        .collect();
                    Some(self.as_seen(&join_paths(&parts?, name == b"resolve")?))
                }
                (2, b"fileURLToPath") => {
                    let url = self.find_text(file, *arguments.first()?)?;
                    Some(self.as_seen(&read_file_url(&url)?))
                }
                (2, b"pathToFileURL") => {
                    let path = self.find_text(file, *arguments.first()?)?;
                    write_file_url(&self.as_joined(path))
                }
                _ => None,
            };
        }
        match hir[callee].kind {
            ExprKind::Dot { obj, name, .. }
                if matches!(files.atoms().bytes(name), b"toString" | b"toJSON")
                    && self.is_url(file, obj) =>
            {
                self.find_text(file, obj)
            }
            _ => None,
        }
    }

    /// False: the text is no URL that holds code.
    fn add_url(&mut self, url: &[u8]) -> bool {
        if !is_url_with_text(url) {
            return false;
        }
        // Another object's property of the same name: an image is no code that a Worker starts from.
        if self.is_behind_property && !names_type_of_code(url) {
            return true;
        }
        // `bun run` reads what a `data:` URL holds as TypeScript with JSX, whatever type the URL names.
        match self.provider.decode_data_url(url) {
            Some(contents) => self.add_text(url.to_vec(), contents, Loader::Tsx),
            None => self.has_unseen_start = true,
        }
        true
    }

    fn add_text(&mut self, name: Vec<u8>, contents: Vec<u8>, loader: Loader) {
        let started_at = Some(self.position_of_start());
        self.texts.push(WorkerFile {
            source_path: name.clone(),
            embedded_path: name,
            is_guess: false,
            has_options: self.has_options,
            started_at,
            text: Some((contents, loader as u8)),
            is_named_by_path: false,
        });
    }

    /// False: the text is no code, it says where the code is.
    fn add_evaluated_text(&mut self, text: &[u8]) -> bool {
        if self.is_evaluated {
            self.add_text_of_blob(text.to_vec(), None);
        }
        self.is_evaluated
    }

    // The run time knows the text behind an object URL by what it says.
    fn add_text_of_blob(&mut self, contents: Vec<u8>, r#type: Option<&[u8]>) {
        let loader = self.provider.loader_of_blob(r#type);
        match loader.filter(|it| LOADERS_OF_CODE.contains(it)) {
            Some(loader) => self.add_text(name_of_text(loader, &contents), contents, loader),
            None => self.has_unseen_start = true,
        }
    }

    /// The value of the property in an object literal that says nothing else about it. `Err`: the expression is no such literal.
    fn find_property(
        &self,
        file: FileId,
        object: ExprId,
        name: &[u8],
    ) -> Result<Option<ExprId>, ()> {
        let hir = self.files.hir(file);
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(object)].kind else {
            return Err(());
        };
        let mut found = None;
        for property in properties.iter().map(|property| hir[property]) {
            let key = property.key.name().ok_or(())?;
            if self.files.atoms().bytes(key) != name {
                continue;
            }
            found = match property.kind {
                PropKind::Init => Some(property.value),
                _ => return Err(()),
            };
        }
        Ok(found)
    }

    // `new Worker(text, { eval: true })` of node:worker_threads, which makes a Blob without a type of the text.
    fn follow_evaluated_text(&mut self, file: FileId, text: ExprId, options: ExprId) -> bool {
        let evaluates = match self.find_property(file, options, b"eval") {
            Ok(Some(evaluates)) => evaluates,
            Ok(None) => return false,
            Err(()) => {
                self.has_unseen_start = true;
                return false;
            }
        };
        let decisions = &self.files.analysis(file).decisions;
        match decisions.constant(self.files.hir(file), evaluates) {
            FoldedValue::Constant(Constant::Boolean(true)) => {}
            FoldedValue::Constant(Constant::Boolean(false)) => return false,
            _ => {
                self.has_unseen_start = true;
                return false;
            }
        }
        self.is_evaluated = true;
        self.follow(file, text);
        self.is_evaluated = false;
        true
    }

    // `new Worker(path, { preload: "./first.ts" })` and `{ preload: ["./first.ts", ..] }`: the Worker loads those files in front of its own.
    fn follow_preloads(&mut self, file: FileId, options: ExprId) {
        self.variables_left = (self.limits).get(LimitId::MaxVariablesFollowedToLoader);
        let mut names = Vec::new();
        self.find_preloads(file, options, &mut names);
        for name in names {
            self.follow(file, name);
        }
    }

    /// Adds what every `preload` names that the object literal writes, or a literal that it spreads.
    fn find_preloads(&mut self, file: FileId, options: ExprId, names: &mut Vec<ExprId>) {
        let (hir, atoms) = (self.files.hir(file), self.files.atoms());
        let ExprKind::Object(properties) = hir[self.find_initializer(file, options)].kind else {
            return;
        };
        for property in properties.iter().map(|property| hir[property]) {
            let key = property.key.name();
            match property.kind {
                PropKind::Spread => self.find_preloads(file, property.value, names),
                PropKind::Init | PropKind::Shorthand
                    if key.is_some_and(|key| atoms.bytes(key) == b"preload") =>
                {
                    let preload = self.find_initializer(file, property.value);
                    match hir[preload].kind {
                        ExprKind::Array(list) => names.extend(hir.ids(list)),
                        _ => names.push(preload),
                    }
                }
                _ => {}
            }
        }
    }

    // `URL.createObjectURL(new Blob([text, ..], { type }))`
    fn follow_object_url(&mut self, file: FileId, call: CallId) -> Option<()> {
        let hir = self.files.hir(file);
        let callee = hir.skip_type_assertions(hir[call].callee);
        if self.find_builtin(file, callee)? != self.object_url_maker? {
            return None;
        }
        let blob = self.find_initializer(file, hir.ids(hir[call].args).next()?);
        let ExprKind::New(blob) = hir[blob].kind else {
            return None;
        };
        let constructor = hir.skip_type_assertions(hir[blob].callee);
        if self.find_builtin(file, constructor)? != self.blob_constructor? {
            return None;
        }
        let mut arguments = hir.ids(hir[blob].args);
        let written = arguments.next()?;
        let parts = self.find_initializer(file, written);
        // Whoever else holds the list can add to it.
        self.has_unseen_start |= parts != hir.skip_type_assertions(written);
        let ExprKind::Array(parts) = hir[parts].kind else {
            return None;
        };
        let mut contents = Vec::new();
        for part in hir.ids(parts) {
            let is_text = !self.is_url(file, part);
            contents.append(&mut self.find_text(file, part).filter(|_| is_text)?);
        }
        if !is_valid_utf8(&contents) {
            return None;
        }
        let r#type = match arguments.next() {
            None => None,
            Some(options) => match self.find_property(file, options, b"type").ok()? {
                None => None,
                Some(written) => Some(self.find_text(file, written)?),
            },
        };
        self.add_text_of_blob(contents, r#type.as_deref());
        Some(())
    }

    /// What a variable that is never assigned again was declared with, or the expression itself.
    fn find_initializer(&mut self, file: FileId, expression: ExprId) -> ExprId {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let expression = hir.skip_type_assertions(expression);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[expression].kind, bound.binding(expression))
        else {
            return expression;
        };
        match self.find_initializer_of(file, symbol) {
            BindingInitializer::Expression(source) if self.variables_left > 0 => {
                self.variables_left -= 1;
                self.find_initializer(file, source)
            }
            _ => expression,
        }
    }

    /// False: the text is no path under which the executable would hold a file of code that the build finds. An executable looks in its own root for what a relative path names.
    fn add_path(&mut self, written_in: FileId, text: &[u8]) -> bool {
        let text = &self.as_joined(text.to_vec())[..];
        let &WorkerSearch {
            paths,
            runs_in_place,
            resolve_entry_point,
            resolve_bare_name,
            ..
        } = self.search;
        let root = match runs_in_place {
            true => with_separators_of_program(&paths.root_directory),
            false => with_forward_slashes(paths.module_prefix.clone()),
        };
        // A package names the file of a Worker that most programs never start, and the program of such a file is no small one.
        // What the project names and hands to a package is a file of the project, which it means to start.
        if is_in_node_modules(self.files.file_name(written_in)) {
            return false;
        }
        let is_relative = text.starts_with(b"./") || text.starts_with(b"../");
        let named = match text.starts_with(b"file:") {
            true => read_file_url(text),
            false if is_relative && !runs_in_place => Some(join_below_root(&root, text)),
            false if is_relative || is_absolute(text) => {
                join_paths(&[root.clone(), text.to_vec()], true)
            }
            false => None,
        };
        // No extension is added to such a name, so it is not the same name without its end.
        let names_directory =
            matches!(text, [.., b'/'] | [.., b'/', b'.'] | [.., b'/', b'.', b'.']);
        let find_on_disk = |named: &[u8]| {
            let mut written = match runs_in_place {
                true => named.to_vec(),
                false => find_path_on_disk(&paths.root_directory, &root, named)?,
            };
            if names_directory {
                written.push(b'/');
            }
            resolve_entry_point(&written)
        };
        let is_written_down = !runs_in_place && !names_directory;
        // An entry point above the folder where the build runs moves the root directory up. The program was written for `bun run`, which looks from that folder, so what lies there comes first.
        let looks_elsewhere = is_written_down && self.builds_outside_root();
        let Some(named) = named else {
            let below_node_modules = join_below_root(&root, &[b"node_modules/", text].concat());
            let from_root = resolve_bare_name(text);
            let elsewhere = match looks_elsewhere {
                true => resolve_entry_point(text).filter(|path| from_root.as_ref() != Some(path)),
                false => None,
            };
            if let Some(path) = elsewhere {
                let file = resolve_entry_point(&[b"./", text].concat());
                let named = match file.is_some_and(|file| file == path) {
                    true => name_from_working_directory(text),
                    false => name_from_working_directory(&[b"node_modules/", text].concat()),
                };
                return self.add_file(&path, Some(&named));
            }
            let Some(path) = from_root else {
                return false;
            };
            if !is_written_down {
                return self.add_file(&path, None);
            }
            // The executable looks below `node_modules` for the name, then in its root.
            let in_root = join_below_root(&root, text);
            let named = match find_on_disk(&in_root).is_some_and(|found| found == path) {
                true => in_root,
                false => below_node_modules,
            };
            return self.add_file(&path, Some(&named));
        };
        // What `..` makes of a path in the root lies beside the root. The executable holds what lies beside the root directory under `_.._`.
        let above_root = dirname::<Posix>(root.strip_suffix(b"/").unwrap_or(&root));
        let beside_root = (named.strip_prefix(above_root)).filter(|rest| rest.starts_with(b"/"));
        let named = match beside_root {
            Some(rest) if !runs_in_place && !named.starts_with(&root) => {
                [&root[..], b"_.._", rest].concat()
            }
            Some(_) | None => named,
        };
        let found = find_on_disk(&named);
        let elsewhere = match is_relative && looks_elsewhere {
            true => resolve_entry_point(text).filter(|path| found.as_ref() != Some(path)),
            false => None,
        };
        match elsewhere {
            Some(path) => self.add_file(&path, Some(&name_from_working_directory(text))),
            None => found
                .is_some_and(|path| self.add_file(&path, is_written_down.then_some(&named[..]))),
        }
    }

    // `new URL("../../jobs/job.js", import.meta.url)` in the root: the steps up leave nothing of the executable's prefix, so `/jobs/job.js` does not say which file is meant. The same expression over the path of the source does.
    fn add_path_above_prefix(&mut self, file: FileId, expression: ExprId, text: &[u8]) -> bool {
        let &WorkerSearch {
            paths,
            runs_in_place,
            resolve_entry_point,
            ..
        } = self.search;
        let read_path = |walk: &Self, text: &[u8]| {
            let text = walk.as_joined(text.to_vec());
            match text.starts_with(b"file:") {
                true => read_file_url(&text),
                false => Some(text).filter(|path| is_absolute(path)),
            }
        };
        let written_in = self.files.file_name(file);
        if runs_in_place || self.is_evaluated || is_in_node_modules(written_in) {
            return false;
        }
        let Some(named) = read_path(self, text).filter(|path| !path.ends_with(b"/")) else {
            return false;
        };
        let root = with_forward_slashes(paths.module_prefix.clone());
        let above_root = dirname::<Posix>(root.strip_suffix(b"/").unwrap_or(&root));
        if (named.strip_prefix(above_root)).is_some_and(|rest| rest.starts_with(b"/")) {
            return false;
        }
        self.reads_source_paths = true;
        self.names_own_path.set(false);
        let on_disk = self.find_text(file, expression);
        self.reads_source_paths = false;
        // A path that does not come from the file's own names a file of the machine that the program runs on.
        let on_disk = on_disk.filter(|on_disk| on_disk != text || self.names_own_path.get());
        let found = on_disk.and_then(|on_disk| resolve_entry_point(&read_path(self, &on_disk)?));
        found.is_some_and(|path| self.add_file(&path, Some(&named)))
    }

    /// `new Worker("./jobs/" + name + ".js")`: every file of code that the name can lead to. False: the name is not known in part, or it may be something else than the path of a file.
    fn add_files_named_in_part(&mut self, file: FileId, argument: ExprId) -> bool {
        let files = self.files;
        let analysis = files.analysis(file);
        let written_in = files.file_name(file);
        let Some(specifier) = analysis.find_name_of_worker(argument) else {
            return false;
        };
        if is_in_node_modules(written_in) {
            return false;
        }
        let names: Option<Vec<(&[u8], Option<&[u8]>)>> =
            (analysis.alternatives_of(specifier).iter())
                .map(|&name| match name {
                    ImportSpecifier::Constant(text) => Some((files.atoms().bytes(text), None)),
                    ImportSpecifier::Pattern { prefix, suffix } => Some((
                        files.atoms().bytes(prefix),
                        Some(files.atoms().bytes(suffix)),
                    )),
                    ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => None,
                })
                .collect();
        let Some(names) = names else {
            return false;
        };
        let is_answer_of_resolver = analysis.find_resolved_form(argument).is_some();
        let is_relative = |name: &[u8]| name.starts_with(b"./") || name.starts_with(b"../");
        if !is_answer_of_resolver && !names.iter().all(|name| is_relative(name.0)) {
            return false;
        }
        // An executable looks in its own root for what a relative path names.
        let is_from_own_folder =
            is_answer_of_resolver || analysis.is_path_from_own_directory(argument);
        let find = self.search.find_files_named_in_part;
        let found = find(
            match is_from_own_folder {
                true => SearchedFrom::FolderOf(written_in),
                false => SearchedFrom::RootDirectory,
            },
            &names,
        );
        let Some(found) = found else {
            return false;
        };
        if !is_from_own_folder
            && self.builds_outside_root()
            && !self.add_files_below_working_directory(&names)
        {
            return false;
        }
        for path in found {
            self.add_file(&path, None);
        }
        true
    }

    fn builds_outside_root(&self) -> bool {
        let search = self.search;
        !search.runs_in_place && to_native(search.working_directory) != search.paths.root_directory
    }

    /// As in `add_path`: they come ahead of what the root directory holds under the same names.
    fn add_files_below_working_directory(&mut self, names: &[(&[u8], Option<&[u8]>)]) -> bool {
        let search = self.search;
        let found = (search.find_files_named_in_part)(SearchedFrom::WorkingDirectory, names);
        let Some(found) = found else {
            return false;
        };
        let directory = to_native(search.working_directory);
        for path in found {
            let Some(written) = compute_relative_path(directory, to_native(&path)) else {
                return false;
            };
            let written = with_forward_slashes(written);
            self.add_file(&path, Some(&name_from_working_directory(&written)));
        }
        true
    }

    /// `named`: the path under which the executable is to find the file.
    fn add_file(&mut self, path: &[u8], named: Option<&[u8]>) -> bool {
        let &WorkerSearch {
            loaders,
            paths,
            runs_in_place,
            ..
        } = self.search;
        let is_code = loader_named_by_path(loaders, path)
            .is_some_and(|loader| script_kind_of(loader).is_some());
        let native_path = to_native(path);
        let Some(name) = compute_relative_path(&paths.root_directory, native_path) else {
            return false;
        };
        let embedded_path = match runs_in_place {
            true => native_path.to_vec(),
            false => [&paths.module_prefix[..], &name[..]].concat(),
        };
        if !is_code || is_host_path(path) {
            return false;
        }
        let held_as = with_forward_slashes(compute_module_path(paths, &name));
        let root = with_forward_slashes(paths.module_prefix.clone());
        let is_held_as = |named: &[u8]| match named.strip_prefix(b"./") {
            Some(below_root) => held_as.strip_prefix(&root[..]) == Some(below_root),
            None => named == held_as,
        };
        if let Some(named) = named.filter(|&named| !is_held_as(named)) {
            self.names.push(EntryPointPaths {
                public_path: named.to_vec(),
                source_path: source_path_of(path),
            });
        }
        let started_at = Some(self.position_of_start());
        self.texts.push(WorkerFile {
            source_path: source_path_of(path),
            embedded_path,
            is_guess: false,
            has_options: self.has_options,
            started_at,
            text: None,
            is_named_by_path: true,
        });
        true
    }

    fn position_of_start(&mut self) -> ShownPosition {
        let (file, start) = self.start;
        let offset = self.files.hir(file)[start].pos;
        let unlocated = new_driver_diagnostic(0, Category::Message, Vec::new(), &[]);
        let files = self.files;
        let known = self.locator.take().filter(|it| it.0 == file);
        let locator = known.unwrap_or_else(|| {
            let text = &files.hir(file).text[..];
            (file, TextLocator::new(files.file_name(file), text))
        });
        let locator = &self.locator.insert(locator).1;
        let located = locator.locate(offset, offset, unlocated);
        let line = located.line.saturating_sub(located.source_line) as usize;
        ShownPosition {
            position: position_of_diagnostic(&located),
            line_text: located.source.get(line).cloned().unwrap_or_default(),
        }
    }

    // `(await import("./worker.js", { with: { type: "file" } })).default`. False: the object is not what such an import answers.
    fn follow_default_of(&mut self, file: FileId, namespace: ExprId) -> bool {
        let hir = self.files.hir(file);
        let ExprKind::Await(promise) = hir[hir.skip_type_assertions(namespace)].kind else {
            return false;
        };
        let call = hir.skip_type_assertions(promise);
        let site = self.files.analysis(file).import_site_of_call(call);
        self.follow_export(file, site, known::default);
        true
    }

    fn follow_name(&mut self, file: FileId, mention: ExprId) {
        let files = self.files;
        let bound = files.bound(file);
        let Binding::Symbol(symbol) = bound.binding(mention) else {
            self.has_unseen_start = true;
            return;
        };
        let &[Decl::Param(pattern)] = bound.symbol(symbol).decls else {
            return self.follow_symbol(file, symbol);
        };
        let is_loaded = parsed_source(files, file).is_some() && files.answers(file).is_some();
        if !is_loaded || self.parameters_left == 0 {
            self.has_unseen_start = true;
            return;
        }
        self.parameters_left -= 1;
        let (hir, decisions) = (files.hir(file), &files.analysis(file).decisions);
        // Under `with` the answer is that of the mention, and it is none.
        let is_of_parameter = (bound.dynamic_lookup_scope(NodeData::Expr(mention))).is_none();
        let known = (self.values_of_parameters.get(&(file, symbol))).filter(|_| is_of_parameter);
        let values = match known {
            Some(values) => values.clone(),
            None => {
                let places = self.find_places_of_names(file);
                let find_written = |name: Atom| places.get(&name).cloned().unwrap_or_default();
                let values = find_values_passed_for(hir, bound, decisions, mention, &find_written)
                    .map(|values| values.to_vec());
                if is_of_parameter {
                    (self.values_of_parameters).insert((file, symbol), values.clone());
                }
                values
            }
        };
        if let Some(values) = values {
            for &value in &values {
                self.push(file, value);
            }
            return;
        }
        self.has_unseen_start = true;
        match bound.pat_parent[pattern.idx()] {
            PatParent::Param(parameter) => self.follow_parameter(file, parameter),
            // `({ entry }) => new Worker(entry)`
            PatParent::Prop(_, property) if !hir[property].is_rest => {
                if hir[property].default.is_some() {
                    self.push(file, hir[property].default);
                }
                if let PropKey::Name(name) = hir.runtime_binding_key(property) {
                    self.follow_property(file, name, false);
                }
            }
            _ => {}
        }
    }

    /// `export function spawn(entry) { return new Worker(entry); }`: what the calls of `spawn` pass, in whichever file they stand.
    fn follow_parameter(&mut self, file: FileId, parameter: ParamId) {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        // `export function spawn(entry = workerUrl())`: whoever passes nothing gets the default.
        if hir[parameter].default.is_some() {
            self.push(file, hir[parameter].default);
        }
        let function = bound.param_fn[parameter.idx()];
        let index = hir[function].params.iter().position(|it| it == parameter);
        let Some(index) = index.filter(|_| !hir[parameter].flags.contains(Flags::REST)) else {
            return;
        };
        let calls = match self.calls.get(&(file, function, index)) {
            Some(calls) => Rc::clone(calls),
            None => {
                let mut ways = Vec::new();
                self.add_ways_to_function(file, function, &mut ways);
                let is_constructor = hir.runtime_function_kind(function) == FnKind::Constructor;
                let calls = Rc::new(self.find_calls_through(ways, is_constructor, index));
                self.calls
                    .insert((file, function, index), Rc::clone(&calls));
                calls
            }
        };
        self.note_parameter(&calls.ways, index);
        // What is pushed once is not pushed again.
        if !(self.parameters_followed).insert((file, function, index, self.is_behind_property))
            || self.was_followed_by_name(FollowedByName::Parameter(file, function, index))
        {
            return;
        }
        for &(caller, argument) in &calls.arguments {
            self.push(caller, argument);
        }
    }

    /// Files out of sight may get hold of the function in the same ways.
    /// Behind the name of a property the way is a guess. In this program it costs a look. Told to the programs above, each guess makes a start of every call there, and those lead to more guesses.
    fn note_parameter(&mut self, ways: &[Declaration], index: usize) {
        if !self.search.is_built_upon || self.is_behind_property {
            return;
        }
        let place = PlaceOfStart {
            index: index as u32,
            has_options: self.has_options,
            is_evaluated: self.is_evaluated,
        };
        for &way in ways {
            let places = self.parameters.entry(way).or_default();
            if !places.contains(&place) {
                places.push(place);
            }
        }
    }

    /// `new Worker(this.options.filename)`: what is stored under the name, in whichever file.
    /// Objects are not told apart. A value in another object's property of the same name counts only if it names a file of code, and then costs the build of that file.
    /// `new Worker(this.file)`: what the file puts into `this.file` is no guess.
    fn follow_property(&mut self, file: FileId, name: Atom, is_of_this: bool) {
        self.has_unseen_start = true;
        if self.variables_left == 0 {
            return;
        }
        self.variables_left -= 1;
        // `this.#file` is stored to inside its class.
        let is_private = self.files.atoms().bytes(name).starts_with(b"#");
        let was_behind_property = self.is_behind_property;
        if self.search.is_built_upon && !is_private && !was_behind_property {
            let place = PlaceOfStart {
                index: 0,
                has_options: self.has_options,
                is_evaluated: self.is_evaluated,
            };
            let places = self.properties.entry(name).or_default();
            if !places.contains(&place) {
                places.push(place);
            }
        }
        let reads_itself = is_of_this || is_private;
        // A guess is no ground for another: two names on, most of the program stores under one of them, and whatever there names a file of code would be built as a Worker's.
        if was_behind_property && !reads_itself {
            return;
        }
        // A name like `path` is read at thousands of places and stored to at as many. What is pushed once is not pushed again, so a second walk over the stores adds nothing.
        let reader = reads_itself.then_some(file);
        let asked = (name, reader, self.parameters_left > 0, was_behind_property);
        if !self.properties_followed.insert(asked)
            || self.was_followed_by_name(FollowedByName::Property(name, reader))
        {
            return;
        }
        let sites = self.find_sites();
        for &stored in sites.stored.get(&name).into_iter().flatten() {
            let is_in_file = stored.file() == file;
            let is_own = reads_itself && is_in_file && (is_private || stored.is_in_object_itself());
            if (is_private && !is_in_file) || (was_behind_property && !is_own) {
                continue;
            }
            self.is_behind_property = was_behind_property || !is_own;
            match stored {
                Stored::Value(holder, value) | Stored::Field(holder, value) => {
                    self.push(holder, value);
                }
                Stored::Results(holder, function) => self.follow_results_of(holder, function),
                Stored::Parameter(holder, parameter) if self.parameters_left > 0 => {
                    self.parameters_left -= 1;
                    self.follow_parameter(holder, parameter);
                    self.parameters_left += 1;
                }
                Stored::Parameter(..) => {}
            }
        }
        self.is_behind_property = was_behind_property;
    }

    fn find_sites(&mut self) -> Rc<Sites> {
        if let Some(sites) = &self.sites {
            return Rc::clone(sites);
        }
        let (files, below) = (self.files, self.names_below);
        let reach = find_files_that_reach(files, &self.files_with_starts);
        let compiled = files.compiled_files().iter().copied();
        let reaching: Vec<FileId> = compiled.filter(|file| reach.contains(file)).collect();
        let found = map_each(reaching.clone(), self.in_parallel, &|file| {
            find_sites_of_file(files, file, below)
        });
        let mut sites = Sites::default();
        for (file, of_file) in reaching.into_iter().zip(found) {
            for (called, call) in of_file.calls {
                sites.calls.entry(called).or_default().push((file, call));
            }
            for (extended, class) in of_file.heirs {
                sites.heirs.entry(extended).or_default().push((file, class));
            }
            for (name, stored) in of_file.stored {
                sites.stored.entry(name).or_default().push(stored);
            }
        }
        let sites = Rc::new(sites);
        self.sites = Some(Rc::clone(&sites));
        sites
    }

    fn add_ways_to_function(&self, file: FileId, function: FnId, ways: &mut Vec<Declaration>) {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        match (
            hir.runtime_function_kind(function),
            bound.fns[function.idx()].owner,
        ) {
            (FnKind::Decl, _) => {
                self.add_ways_to_variable(file, bound.declared_symbol(Decl::Fn(function)), ways);
            }
            (FnKind::Constructor, FnOwner::Member(member)) => {
                if let MemberOwner::Class(class) = bound.member_owner[member.idx()] {
                    self.add_ways_to_class(file, class, ways);
                }
            }
            (FnKind::Method, FnOwner::Member(member)) => {
                ways.extend(hir[member].key.name().map(Declaration::Member));
            }
            (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(expression)) => {
                self.add_ways_to_value(file, expression, ways);
            }
            _ => {}
        }
    }

    fn add_ways_to_class(&self, file: FileId, class: ClassId, ways: &mut Vec<Declaration>) {
        let bound = self.files.bound(file);
        match bound.class_owner[class.idx()] {
            ClassOwner::Stmt(_) => {
                self.add_ways_to_variable(file, bound.declared_symbol(Decl::Class(class)), ways);
            }
            ClassOwner::Expr(expression) => self.add_ways_to_value(file, expression, ways),
        }
    }

    /// The variable itself, and where each mention of it puts what it holds.
    fn add_ways_to_variable(&self, file: FileId, variable: SymbolId, ways: &mut Vec<Declaration>) {
        if !variable.is_some() || ways.contains(&Declaration::Here(file, variable)) {
            return;
        }
        ways.push(Declaration::Here(file, variable));
        let bound = self.files.bound(file);
        let places = self.find_places_of_names(file);
        for &mention in places
            .get(&bound.symbol(variable).name)
            .into_iter()
            .flatten()
        {
            if bound.is_evaluated_ident(mention)
                && bound.binding(mention) == Binding::Symbol(variable)
            {
                self.add_ways_to_value(file, mention, ways);
            }
        }
    }

    fn find_places_of_names(&self, file: FileId) -> Rc<FxHashMap<Atom, Vec<ExprId>>> {
        let mut known = self.places_of_names.borrow_mut();
        let places = known.entry(file);
        Rc::clone(places.or_insert_with(|| Rc::new(find_places_of_names(self.files.hir(file)))))
    }

    /// Where the value of the expression is put: `const start = ..`, `{ start: .. }`, `exports.start = ..`, `module.exports = ..`, `export default ..`.
    fn add_ways_to_value(&self, file: FileId, mut value: ExprId, ways: &mut Vec<Declaration>) {
        let (hir, bound) = (self.files.hir(file), self.files.bound(file));
        let mut add = |way: Declaration| {
            if !ways.contains(&way) {
                ways.push(way);
            }
        };
        let held_in = loop {
            let Parent::Expr(parent) = bound.parent_of_expr(value) else {
                break bound.parent_of_expr(value);
            };
            match hir[parent].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value: assigned,
                } if assigned == value => {
                    let target = hir.skip_type_assertions(target);
                    match hir[target].kind {
                        ExprKind::Dot { obj, name, .. } => {
                            let holder = bound.binding(hir.skip_type_assertions(obj));
                            let is_whole = name == known::exports
                                && holder == Binding::CommonJs(CommonJsVariable::Module);
                            add(match is_whole {
                                true => Declaration::Whole(file),
                                false => Declaration::Member(name),
                            });
                        }
                        ExprKind::Ident(_) => {
                            if let Binding::Symbol(variable) = bound.binding(target) {
                                self.add_ways_to_variable(file, variable, ways);
                                return self.add_ways_to_value(file, parent, ways);
                            }
                        }
                        _ => {}
                    }
                }
                _ if hir.type_assertion_operand(parent) == Some(value) => {}
                _ => return,
            }
            value = parent;
        };
        match held_in {
            Parent::VarInit(declaration) => {
                let pattern = hir[declaration].pat;
                if let (PatKind::Ident(_), Binding::Symbol(variable)) =
                    (hir[pattern].kind, bound.initialized_binding(pattern))
                {
                    self.add_ways_to_variable(file, variable, ways);
                }
            }
            Parent::Prop(property) if hir[property].kind != PropKind::Spread => {
                if let Some(name) = hir[property].key.name() {
                    add(Declaration::Member(name));
                }
            }
            Parent::MemberInit(member) => {
                if let Some(name) = hir[member].key.name() {
                    add(Declaration::Member(name));
                }
            }
            Parent::Stmt(statement) => match hir[statement].kind {
                StmtKind::ExportDefault(_) => {
                    let exported = bound.declared_symbol(Decl::ExportExpr(statement));
                    if exported.is_some() {
                        add(Declaration::Here(file, exported));
                    }
                }
                StmtKind::ExportAssign(_) => add(Declaration::Whole(file)),
                _ => {}
            },
            _ => {}
        }
    }

    /// What the calls in this program pass for the parameter at `index` of what `ways` lead to.
    fn find_calls_through(
        &mut self,
        mut ways: Vec<Declaration>,
        is_constructor: bool,
        index: usize,
    ) -> Calls {
        let files = self.files;
        let mut arguments = Vec::new();
        if ways.is_empty() {
            return Calls { ways, arguments };
        }
        let sites = self.find_sites();
        // `class Sub extends Pool {}`: `new Sub(..)` runs the constructor of `Pool`. Where `Sub` has a constructor, its `super(..)` does.
        let mut constructors_of_heirs: Vec<(FileId, FnId)> = Vec::new();
        let mut looked_at = 0;
        while is_constructor && looked_at < ways.len() {
            let heirs = sites.heirs.get(&ways[looked_at]);
            looked_at += 1;
            for &(file, class) in heirs.into_iter().flatten() {
                match find_constructor(files.hir(file), class) {
                    Some(constructor) if constructors_of_heirs.contains(&(file, constructor)) => {}
                    Some(constructor) => constructors_of_heirs.push((file, constructor)),
                    None => self.add_ways_to_class(file, class, &mut ways),
                }
            }
        }
        // Many functions are got hold of in one way, `Declaration::Member` above all.
        for &way in &ways {
            let passed = match self.arguments_through.get(&(way, index)) {
                Some(passed) => Rc::clone(passed),
                None => {
                    let calls = sites.calls.get(&way).into_iter().flatten();
                    let passed = calls.filter_map(|&(file, call)| {
                        Some((file, find_argument(files.hir(file), call, index)?))
                    });
                    let passed: Rc<Vec<(FileId, ExprId)>> = Rc::new(passed.collect());
                    (self.arguments_through).insert((way, index), Rc::clone(&passed));
                    passed
                }
            };
            arguments.extend(passed.iter().copied());
        }
        let of_heirs = constructors_of_heirs
            .iter()
            .flat_map(|&(file, constructor)| {
                let calls = find_calls_of_super(files.hir(file), constructor).into_iter();
                calls.map(move |call| (file, call))
            });
        for (file, call) in of_heirs {
            arguments.extend(find_argument(files.hir(file), call, index).map(|it| (file, it)));
        }
        Calls { ways, arguments }
    }

    /// What a call of the function answers with: each `return` of its own.
    fn follow_results_of(&mut self, file: FileId, function: FnId) {
        let hir = self.files.hir(file);
        let statements = match hir[function].body {
            FnBody::Expr(value) => return self.push(file, value),
            FnBody::Block(statements) => statements,
            FnBody::None => return,
        };
        let mut stack: Vec<TreeNode> = hir.ids(statements).map(TreeNode::Stmt).collect();
        while let Some(node) = stack.pop() {
            // A `return` inside an expression belongs to another function.
            let TreeNode::Stmt(statement) = node else {
                continue;
            };
            match hir[statement].kind {
                StmtKind::Return(value) if value.is_some() => self.push(file, value),
                _ => push_children(hir, node, &mut stack),
            }
        }
    }

    fn follow_symbol(&mut self, file: FileId, symbol: SymbolId) {
        let files = self.files;
        if self.variables_left == 0 {
            self.has_unseen_start = true;
            return;
        }
        self.variables_left -= 1;
        match self.find_initializer_of(file, symbol) {
            BindingInitializer::Expression(source) => self.push(file, source),
            BindingInitializer::Function(function) => self.follow_results_of(file, function),
            // `const { filename } = this.options`
            BindingInitializer::PatternProperty { source, path } => {
                if path[..] != [known::default] || !self.follow_default_of(file, source) {
                    // `const { file } = this`
                    let is_of_this = path.len() == 1 && is_this(files.hir(file), source);
                    match path.last() {
                        Some(&name) => self.follow_property(file, name, is_of_this),
                        None => self.has_unseen_start = true,
                    }
                }
            }
            BindingInitializer::Import => match find_import_of(files, file, symbol) {
                Some((import, name)) => {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    self.follow_export(file, site, name);
                }
                None => self.has_unseen_start = true,
            },
            _ => self.has_unseen_start = true,
        }
    }

    fn follow_export(&mut self, importer: FileId, site: Option<usize>, name: Atom) {
        self.has_unseen_start |= !self.follow_declarations_of_export(importer, site, name);
    }

    /// `export * from "./url.js"` passes on what the file does not export itself. False: no such statement leads to the name.
    fn follow_export_behind_stars(&mut self, exporter: FileId, name: Atom) -> bool {
        let files = self.files;
        let hir = files.hir(exporter);
        if name == known::default {
            return false;
        }
        let mut is_found = false;
        for statement in hir.ids(hir.body) {
            let StmtKind::ExportStar {
                alias,
                type_only: false,
                ..
            } = hir[statement].kind
            else {
                continue;
            };
            if alias.is_some() || self.variables_left == 0 {
                continue;
            }
            self.variables_left -= 1;
            let kind = ImportSiteKind::ExportStar(statement);
            let site = files.analysis(exporter).import_site_index(kind);
            is_found |= self.follow_declarations_of_export(exporter, site, name);
        }
        is_found
    }

    /// False: what the name is exported with is not all followed.
    fn follow_declarations_of_export(
        &mut self,
        importer: FileId,
        site: Option<usize>,
        name: Atom,
    ) -> bool {
        let files = self.files;
        let answer = site.and_then(|site| files.answers(importer)?.0.get(site));
        let Some(&CodeAnswer::File(exporter)) = answer else {
            return false;
        };
        let is_copy = parsed_source(files, exporter)
            .is_some_and(|it| it.kind == SourceKind::Data && it.loader == Loader::File);
        if is_copy {
            let is_path = name == known::default && !self.is_evaluated;
            if is_path {
                self.copies.push((exporter, self.has_options));
            }
            return is_path;
        }
        if files.answers(exporter).is_none() {
            return false;
        }
        let (hir, bound) = (files.hir(exporter), files.bound(exporter));
        let exports = bound.table(bound.symbol(bound.file_symbol).exports);
        let Some(&(_, export)) = exports.iter().find(|entry| entry.0 == name) else {
            return self.follow_export_behind_stars(exporter, name);
        };
        let mut follows_all = true;
        for &declaration in bound.symbol(export).decls {
            match declaration {
                Decl::ExportSpec(specifier) => {
                    let item = hir[specifier];
                    let statement = hir[item.export];
                    if item.type_only || statement.type_only {
                        continue;
                    }
                    if statement.has_module_specifier && self.variables_left > 0 {
                        self.variables_left -= 1;
                        let kind = ImportSiteKind::ExportFrom(item.export);
                        let site = files.analysis(exporter).import_site_index(kind);
                        self.follow_export(exporter, site, item.local);
                    } else if statement.has_module_specifier {
                        follows_all = false;
                    } else if let Binding::Symbol(local) = bound.exported_binding(specifier) {
                        self.follow_symbol(exporter, local);
                    } else {
                        follows_all = false;
                    }
                }
                Decl::Var(_) | Decl::Fn(_) => {
                    self.follow_symbol(exporter, bound.declared_symbol(declaration));
                }
                Decl::ExportExpr(statement) => match hir[statement].kind {
                    StmtKind::ExportDefault(value) => self.push(exporter, value),
                    _ => follows_all = false,
                },
                _ => follows_all = false,
            }
        }
        follows_all
    }
}

/// What a call passes for the parameter at `index`. None behind a spread, which moves the places.
fn find_argument(hir: &File<'_>, call: CallId, index: usize) -> Option<ExprId> {
    let mut passed = hir.ids(hir[call].args).take(index + 1);
    let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
    match passed.clone().any(is_spread) {
        true => None,
        false => passed.nth(index),
    }
}

/// `{ name: value }` and `object.name = value`: the names that the expression stores under, each with the value. A method is the value of its name.
fn find_names_stored_by(
    hir: &File<'_>,
    expression: ExprId,
) -> impl Iterator<Item = (Atom, ExprId)> {
    let (properties, assigned) = match hir[expression].kind {
        ExprKind::Object(properties) => (properties, None),
        ExprKind::Assign {
            op: None | Some(BinOp::Or | BinOp::And | BinOp::Nullish),
            target,
            value,
        } => match hir[hir.skip_type_assertions(target)].kind {
            ExprKind::Dot { name, .. } => (Span::EMPTY, Some((name, value))),
            _ => (Span::EMPTY, None),
        },
        _ => (Span::EMPTY, None),
    };
    let written = properties.iter().map(|property| hir[property]);
    let written = written.filter(|it| !matches!(it.kind, PropKind::Spread | PropKind::Setter));
    written
        .filter_map(|it| Some((it.key.name()?, it.value)))
        .chain(assigned)
}

fn is_this(hir: &File<'_>, expression: ExprId) -> bool {
    matches!(
        hir[hir.skip_type_assertions(expression)].kind,
        ExprKind::This
    )
}

/// `this.name = value`
fn stores_in_this(hir: &File<'_>, expression: ExprId) -> bool {
    let ExprKind::Assign { target, .. } = hir[expression].kind else {
        return false;
    };
    match hir[hir.skip_type_assertions(target)].kind {
        ExprKind::Dot { obj, .. } => is_this(hir, obj),
        _ => false,
    }
}

/// The constructor that the class writes itself.
fn find_constructor(hir: &File<'_>, class: ClassId) -> Option<FnId> {
    hir[class].members.iter().find_map(|member| {
        let is_constructor = hir.runtime_member_kind(member) == MemberKind::Constructor;
        let function = is_constructor.then_some(hir[member].func)?;
        (!matches!(hir[function].body, FnBody::None)).then_some(function)
    })
}

/// Each `super(..)` of a constructor.
fn find_calls_of_super(hir: &File<'_>, constructor: FnId) -> Vec<CallId> {
    let mut found = Vec::new();
    let mut stack = vec![TreeNode::Function(constructor)];
    while let Some(node) = stack.pop() {
        match node {
            TreeNode::Expr(expression) => {
                if let ExprKind::Call(call) = hir[expression].kind
                    && matches!(hir[hir[call].callee].kind, ExprKind::Super)
                {
                    found.push(call);
                }
            }
            // `super` means something else in there.
            TreeNode::Class(_) => continue,
            TreeNode::Function(function)
                if function != constructor && hir[function].kind != FnKind::Arrow =>
            {
                continue;
            }
            _ => {}
        }
        push_children(hir, node, &mut stack);
    }
    found
}

/// What a callee leads to: `spawn(..)`, `spawning.spawn(..)`, `new Pool(..)` and `pool.start(..)`, imported, required or neither.
fn find_declaration_called(
    files: &dyn CodeView<'_>,
    file: FileId,
    callee: ExprId,
    known: &mut KnownDeclarations,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    find_declaration_behind(files, file, callee, MOST_REEXPORTS, known, is_sought_below)
}

fn find_declaration_behind(
    files: &dyn CodeView<'_>,
    file: FileId,
    expression: ExprId,
    variables_left: usize,
    known: &mut KnownDeclarations,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    let variables_left = variables_left.checked_sub(1)?;
    let (hir, bound) = (files.hir(file), files.bound(file));
    let expression = hir.skip_type_assertions(expression);
    match hir[expression].kind {
        ExprKind::Ident(_) => {
            let Binding::Symbol(symbol) = bound.binding(expression) else {
                return None;
            };
            if let Some(&found) = known.get(&(file, symbol)) {
                return found;
            }
            let found = match find_import_of(files, file, symbol) {
                Some((import, name)) => {
                    let kind = ImportSiteKind::Import(import);
                    let site = files.analysis(file).import_site_index(kind);
                    find_declaration_loaded(files, file, site?, Some(name), is_sought_below)
                }
                None => match bound.binding_initializer(hir, symbol) {
                    // `const start = require("./spawn")`, `const start = spawning.start` and `const begin = start`
                    BindingInitializer::Expression(source) if bound.is_stable_binding(symbol) => {
                        let behind = find_declaration_behind(
                            files,
                            file,
                            source,
                            variables_left,
                            known,
                            is_sought_below,
                        );
                        behind.or(Some(Declaration::Here(file, symbol)))
                    }
                    // `const { start } = require("./spawn")`
                    BindingInitializer::PatternProperty { source, path } => match path[..] {
                        [name] => {
                            find_declaration_of_member(files, file, source, name, is_sought_below)
                        }
                        [.., name] => Some(Declaration::Member(name)),
                        [] => None,
                    },
                    _ => Some(Declaration::Here(file, symbol)),
                },
            };
            known.insert((file, symbol), found);
            found
        }
        ExprKind::Dot { obj, name, .. } => {
            find_declaration_of_member(files, file, obj, name, is_sought_below)
        }
        ExprKind::Call(_) => {
            let site = find_site_that_loads(files, file, expression)?;
            find_declaration_loaded(files, file, site, None, is_sought_below)
        }
        _ => None,
    }
}

/// The import site of `require("./spawn")` and of `await import("./spawn")`.
fn find_site_that_loads(files: &dyn CodeView<'_>, file: FileId, loaded: ExprId) -> Option<usize> {
    let (hir, analysis) = (files.hir(file), files.analysis(file));
    let call = match hir[loaded].kind {
        ExprKind::Await(promise) => hir.skip_type_assertions(promise),
        _ => loaded,
    };
    let site = analysis.import_site_of_call(call)?;
    let is_awaited = call != loaded;
    match analysis.import_sites[site].kind {
        ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) if !is_awaited => {
            Some(site)
        }
        ImportSiteKind::ImportCall(_) if is_awaited => Some(site),
        _ => None,
    }
}

/// `object.name`, where `object` is the object of a module or anything else.
fn find_declaration_of_member(
    files: &dyn CodeView<'_>,
    file: FileId,
    object: ExprId,
    name: Atom,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    match find_site_of_object(files, file, object) {
        Some(site) => find_declaration_loaded(files, file, site, Some(name), is_sought_below),
        None => Some(Declaration::Member(name)),
    }
}

/// The import site that an object comes from: `spawning` in `spawning.start`, imported as a namespace or required.
fn find_site_of_object(files: &dyn CodeView<'_>, file: FileId, object: ExprId) -> Option<usize> {
    let (hir, bound) = (files.hir(file), files.bound(file));
    let object = hir.skip_type_assertions(object);
    match (hir[object].kind, bound.binding(object)) {
        (ExprKind::Ident(_), Binding::Symbol(holder)) => {
            let mut declarations = bound.symbol(holder).decls.iter();
            let namespace = declarations.find_map(|&declaration| match declaration {
                Decl::ImportNamespace(import) => Some(import),
                _ => None,
            });
            match (namespace, bound.binding_initializer(hir, holder)) {
                (Some(import), _) => {
                    let kind = ImportSiteKind::Import(import);
                    files.analysis(file).import_site_index(kind)
                }
                (None, BindingInitializer::Expression(source)) => {
                    find_site_that_loads(files, file, hir.skip_type_assertions(source))
                }
                _ => None,
            }
        }
        (ExprKind::Ident(_), _) => None,
        _ => find_site_that_loads(files, file, object),
    }
}

/// What a file gets from the module that an import site loads: an export, or without a name what `require()` answers.
/// A file that says `exports.start = ..` lists no exports: what it exports is known by the name of the property.
fn find_declaration_loaded(
    files: &dyn CodeView<'_>,
    importer: FileId,
    site: usize,
    name: Option<Atom>,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    let by_name = name.filter(|&name| name != known::default);
    let listed = name.and_then(|name| {
        let site = Some(site);
        find_declaration_of_export(files, importer, site, name, MOST_REEXPORTS, is_sought_below)
    });
    if listed.is_some() {
        return listed;
    }
    match *files.answers(importer)?.0.get(site)? {
        CodeAnswer::File(exporter) => match by_name {
            Some(name) => Some(Declaration::Member(name)),
            None => Some(Declaration::Whole(exporter)),
        },
        CodeAnswer::External {
            kind: ExternalKind::UncompiledCode,
            ..
        } => match by_name {
            Some(name) => Some(Declaration::Member(name)),
            None if is_sought_below(importer, site, known::default) => {
                Some(Declaration::Below(importer, site, known::default))
            }
            None => None,
        },
        _ => None,
    }
}

fn find_declaration_of_export(
    files: &dyn CodeView<'_>,
    importer: FileId,
    site: Option<usize>,
    name: Atom,
    reexports_left: usize,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    let site = site?;
    match *files.answers(importer)?.0.get(site)? {
        CodeAnswer::File(exporter) => {
            find_declaration_exported_by(files, exporter, name, reexports_left, is_sought_below)
        }
        CodeAnswer::External {
            kind: ExternalKind::UncompiledCode,
            ..
        } if is_sought_below(importer, site, name) => {
            Some(Declaration::Below(importer, site, name))
        }
        _ => None,
    }
}

fn find_declaration_exported_by(
    files: &dyn CodeView<'_>,
    exporter: FileId,
    name: Atom,
    reexports_left: usize,
    is_sought_below: &IsSoughtBelow<'_>,
) -> Option<Declaration> {
    let reexports_left = reexports_left.checked_sub(1)?;
    files.answers(exporter)?;
    let (hir, bound) = (files.hir(exporter), files.bound(exporter));
    let find_behind = |kind, name| {
        let site = files.analysis(exporter).import_site_index(kind);
        find_declaration_of_export(files, exporter, site, name, reexports_left, is_sought_below)
    };
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let Some(&(_, export)) = exports.iter().find(|entry| entry.0 == name) else {
        return hir
            .ids(hir.body)
            .find_map(|statement| match hir[statement].kind {
                StmtKind::ExportStar {
                    alias,
                    type_only: false,
                    ..
                } if !alias.is_some() && name != known::default => {
                    find_behind(ImportSiteKind::ExportStar(statement), name)
                }
                _ => None,
            });
    };
    bound
        .symbol(export)
        .decls
        .iter()
        .find_map(|&declaration| match declaration {
            Decl::ExportSpec(specifier) => {
                let item = hir[specifier];
                let statement = hir[item.export];
                if item.type_only || statement.type_only {
                    return None;
                }
                if statement.has_module_specifier {
                    return find_behind(ImportSiteKind::ExportFrom(item.export), item.local);
                }
                let Binding::Symbol(local) = bound.exported_binding(specifier) else {
                    return None;
                };
                match find_import_of(files, exporter, local) {
                    Some((import, name)) => find_behind(ImportSiteKind::Import(import), name),
                    None => Some(Declaration::Here(exporter, local)),
                }
            }
            Decl::Var(_) | Decl::Fn(_) | Decl::Class(_) | Decl::ExportExpr(_) => {
                let declared = bound.declared_symbol(declaration);
                declared
                    .is_some()
                    .then_some(Declaration::Here(exporter, declared))
            }
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_joined_as_node_path_joins_them() {
        let join = |parts: &[&str], resolves: bool| {
            let parts: Vec<Vec<u8>> = parts.iter().map(|part| part.as_bytes().to_vec()).collect();
            join_paths(&parts, resolves)
        };
        let is = |path: &str| Some(path.as_bytes().to_vec());
        assert_eq!(join(&["/a/b", "w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["/a/b", "./c/../w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["/a/b", "../../../w.js"], false), is("/w.js"));
        assert_eq!(join(&["/a/b", "/w.js"], false), is("/a/b/w.js"));
        assert_eq!(join(&["a", "../../w.js"], false), is("../w.js"));
        assert_eq!(join(&["/a/b", "/c", "w.js"], true), is("/c/w.js"));
        assert_eq!(join(&["/a/b", "../w.js"], true), is("/a/w.js"));
        assert_eq!(join(&["a", "w.js"], true), None);
        assert_eq!(join(&["/a", "b\\w.js"], false), None);
    }

    #[test]
    fn a_relative_path_that_leads_out_of_the_root_keeps_its_steps() {
        let join = |relative: &str| join_below_root(b"/$bunfs/root/", relative.as_bytes());
        assert_eq!(join("./a/../w.js"), b"/$bunfs/root/w.js");
        assert_eq!(join("../w.js"), b"/$bunfs/root/_.._/w.js");
        assert_eq!(
            join("./a/../../../b/./w.js"),
            b"/$bunfs/root/_.._/_.._/b/w.js"
        );
    }

    #[test]
    fn a_path_in_the_executable_leads_to_the_file_on_disk() {
        let find = |directory: &str, root: &str, named: &str| {
            find_path_on_disk(directory.as_bytes(), root.as_bytes(), named.as_bytes())
        };
        let is = |path: &str| Some(path.as_bytes().to_vec());
        let posix = "/$bunfs/root/";
        assert_eq!(find("/a/b", posix, "/$bunfs/root/w.cjs"), is("/a/b/w.cjs"));
        assert_eq!(find("/a/b", posix, "/$bunfs/root/_.._/w.js"), is("/a/w.js"));
        assert_eq!(find("/a/b", posix, "/elsewhere/w.js"), None);
        let windows = "B:/~BUN/root/";
        assert_eq!(
            find("C:\\a\\b", windows, "B:/~BUN/root/w.cjs"),
            is("C:/a/b/w.cjs")
        );
        assert_eq!(
            find("C:\\a\\b", windows, "B:/~BUN/root/_.._/lib/w.js"),
            is("C:/a/lib/w.js")
        );
    }

    #[test]
    fn a_url_in_the_executable_leads_to_the_file_on_disk() {
        let find = |directory: &str, prefix: &str, name: &str| {
            let paths = PathOptions {
                module_prefix: prefix.as_bytes().to_vec(),
                root_directory: directory.as_bytes().to_vec(),
                entry_point_names: Vec::new(),
            };
            find_file_named_as_in_executable(&paths, name.as_bytes())
        };
        let is = |path: &str| Some(path.as_bytes().to_vec());
        let posix = "/$bunfs/root/";
        assert_eq!(
            find("/a/b", posix, "file:///$bunfs/root/w.js"),
            is("/a/b/w.js")
        );
        let windows = "B:/~BUN/root/";
        assert_eq!(
            find("C:\\a\\b", windows, "file:///B:/%7EBUN/root/w.js"),
            is("C:/a/b/w.js")
        );
        assert_eq!(
            find("C:\\a\\b\\", windows, "file:///B:/~BUN/root/lib/w.js"),
            is("C:/a/b/lib/w.js")
        );
        assert_eq!(
            find("C:\\a b", windows, "file:///B:/~BUN/root/w%20x.js"),
            is("C:/a b/w x.js")
        );
        assert_eq!(
            find("C:\\a\\b", "B:\\~BUN\\root\\", "file:///B:/~BUN/root/w.js"),
            is("C:/a/b/w.js")
        );
        assert_eq!(find("C:\\a\\b", windows, "file:///C:/a/b/w.js"), None);
    }

    #[test]
    fn an_executable_for_windows_sees_backslashes() {
        let paths = |prefix: &str| PathOptions {
            module_prefix: prefix.as_bytes().to_vec(),
            root_directory: b"/a".to_vec(),
            entry_point_names: Vec::new(),
        };
        assert!(sees_backslashes(&paths("B:/~BUN/root/"), false));
        assert!(sees_backslashes(&paths("B:\\~BUN\\root\\"), false));
        assert!(!sees_backslashes(&paths("/$bunfs/root/"), false));
        assert_eq!(
            sees_backslashes(&paths("B:/~BUN/root/"), true),
            cfg!(windows)
        );
        let seen = with_separators_of_run(b"B:/~BUN/root/a.js", true);
        assert_eq!(seen, b"B:\\~BUN\\root\\a.js");
        let mixed = [&seen[..seen.len() - 5], b"/w.js"].concat();
        assert_eq!(without_separators_of_run(mixed, true), b"B:/~BUN/root/w.js");
        let posix = b"/$bunfs/root/a\\b.js".to_vec();
        assert_eq!(with_separators_of_run(&posix, false), posix);
        assert_eq!(without_separators_of_run(posix.clone(), false), posix);
    }

    #[test]
    fn a_path_comes_back_out_of_its_url() {
        for path in ["/$bunfs/root/a b/w#1%.js", "B:/~BUN/root/w.js"] {
            let url = write_file_url(path.as_bytes()).expect("the path is absolute");
            assert_eq!(read_file_url(&url).as_deref(), Some(path.as_bytes()));
        }
        let url = write_file_url(b"B:/~BUN/root/a b.js");
        assert_eq!(
            url.as_deref(),
            Some(&b"file:///B:/%7EBUN/root/a%20b.js"[..])
        );
        let url = write_file_url(b"/a/[b]^c|d~e.js");
        assert_eq!(
            url.as_deref(),
            Some(&b"file:///a/%5Bb%5D%5Ec%7Cd%7Ee.js"[..])
        );
        assert_eq!(write_file_url(b"w.js"), None);
        assert_eq!(read_file_url(b"file:///a.js?b"), None);
        assert_eq!(read_file_url(b"file://host/a.js"), None);
    }
}
