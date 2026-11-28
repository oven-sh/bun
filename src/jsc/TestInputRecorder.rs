//! `bun test --reuse`, or `BUN_TEST_INPUT_RECORD_DIR=<dir>` with `--isolate`: for every test file,
//! record into the store of the record directory (and, with `BUN_TEST_INPUT_RECORD_JSON`, as
//! `<dir>/<path relative to the record root, URI-component-encoded>.json`) what the file
//! depended on: every resolution made while it was the current file (question and answer), every
//! module it loaded with a hash of the bytes this process transpiled for it, the files that answered
//! a resolution but were never loaded, what it did that a record can't replay, and its outcome counts.
//!
//! Paths under the record root (the repository, see [`record_root`]) are written relative to it, so a
//! record holds in another checkout, and a test file is named by its path from there;
//! a question's specifier, importer and `paths` say so with `specifierFromRoot`, `importerFromRoot`
//! and `pathsFromRoot`. Each resolution carries `check`, a hash of its answer as written: asking the
//! resolver the same question again gives the same `check` when the answer and its details are the same.
//!
//! Files run one at a time on the VM's thread, so the current file is state of the VM, set by
//! [`will_run_file`] and cleared when the returned [`FileRecording`] ends. Work of a finished
//! file that still resolves, loads or marks afterwards is counted as `unattributedBefore` in the next
//! record. An async transpile carries the number of the file that started it, so one that completes
//! while a later file is current is counted in that file's `lateFromEarlierFiles` instead of
//! listed as its module. Worker VMs have no recorder.

use core::cell::{OnceCell, RefCell};
use core::ffi::{CStr, c_char};
use std::io::Write as _;

use bun_ast::Loader;
use bun_collections::StringHashMap;
use bun_core::String as BunString;
use bun_resolver::Result as ResolverResult;

use crate::test_input_store::{self as store, Entry, Segment};
pub use crate::test_own_reads::Root;
pub use crate::test_own_reads::Wrote;
use crate::test_own_reads::{Look, OwnReads};
use crate::virtual_machine::{ResolveMode, VirtualMachine};
use crate::{JSGlobalObject, JSValue};

/// The record format. 3 adds `reads`: a record without them did not record its own reads, so it
/// must not be taken for one that read nothing.
pub const RECORD_VERSION: u32 = 3;

pub struct TestInputRecorder {
    dir: Box<[u8]>,
    /// What paths in records are relative to: see [`record_root`].
    root: Root,
    /// What the run was started with, one `name=value` per line; see `InputReuse::fingerprint`.
    fingerprint: Box<[u8]>,
    fingerprint_hash: [u8; 32],
    state: RefCell<State>,
    /// Opened at the first record; `Some(None)` when it could not be.
    segment: RefCell<Option<Option<Segment>>>,
}

#[derive(Default)]
struct State {
    /// By module key (absolute path). What the isolation source cache serves for a key was
    /// transpiled from one of the sources this process read for it, so the hash is unambiguous
    /// unless two reads differed.
    sources: StringHashMap<Source>,
    file: Option<FileState>,
    /// Resolutions under way, innermost last: an `onResolve` callback can resolve again.
    open: Vec<Option<Found>>,
    unattributed: u32,
    /// Counts the files started; the current file's number while `file` is set.
    file_number: u32,
}

struct Source {
    sha256: [u8; 32],
    loader: Loader,
    is_virtual: bool,
    changed_during_run: bool,
}

#[derive(Default)]
struct FileState {
    /// As a JSON record writes them, and as the store keeps them.
    resolutions: Vec<(Box<[u8]>, Entry)>,
    seen_resolutions: StringHashMap<()>,
    modules: Vec<(Box<[u8]>, bool)>,
    module_index: StringHashMap<usize>,
    /// Absolute paths that answered a resolution.
    answers: Vec<Box<[u8]>>,
    seen_answers: StringHashMap<()>,
    /// What the file did that a record can't replay, by name.
    marks: Vec<Box<[u8]>>,
    unattributed_before: u32,
    /// Async transpiles started by an earlier file that completed while this file was current.
    late_from_earlier_files: u32,
    /// What the file's own code looked at on the file system.
    own: OwnReads,
    /// Modules and questions left out because the file's own code wrote them (see [`FileState::add_resolution`]).
    generated: u32,
    /// Writes whose call returned a promise that had not settled yet: their effects apply once it
    /// is fulfilled (see [`FileState::settle`]).
    pending: Vec<(crate::Strong, OwnWrites)>,
    /// How many of the file's [`OwnWrites`] are alive: calls made but not completed yet, such as
    /// an async `node:fs` call or a pending `Bun.write`. A call that completes after its file
    /// counts down its own file's count, never the next one's.
    in_flight: std::sync::Arc<core::sync::atomic::AtomicU32>,
}

/// What the resolver's result says about the module, beyond its path.
struct Found {
    path: Box<[u8]>,
    json: Box<[u8]>,
}

/// Records into the store in `dir`, an absolute path. `fingerprint` describes the run; records of
/// another fingerprint are not reused.
pub fn enable(vm: &VirtualMachine, fingerprint: &[u8], dir: Box<[u8]>) {
    let recorder = TestInputRecorder {
        dir,
        root: record_root(vm),
        fingerprint: Box::from(fingerprint),
        fingerprint_hash: source_hash(fingerprint),
        state: RefCell::default(),
        segment: RefCell::default(),
    };
    let _ = vm
        .test_isolation_state
        .input_recorder
        .set(Box::new(recorder));
    Bun__TestInputRecorder__enabled.store(true, core::sync::atomic::Ordering::Relaxed);
}

/// What paths in records are relative to, so that a record holds in another checkout: the unit that
/// moves is the repository, not the package. `BUN_TEST_INPUT_RECORD_ROOT` (resolved against the
/// project directory), else the nearest directory at or above the project directory that has a
/// lockfile or `pnpm-workspace.yaml`, which is where the install put `node_modules`, else the
/// project directory. The root itself is in no record, hash or fingerprint.
pub fn record_root(vm: &VirtualMachine) -> Root {
    let top = vm.top_level_dir();
    if let Some(given) = bun_core::env_var::BUN_TEST_INPUT_RECORD_ROOT.get_not_empty() {
        return Root::new(bun_paths::Path::resolve(&[top, given]).as_bytes());
    }
    Root::new(install_root(top).unwrap_or(top))
}

/// Whether the record root is the project directory or above it, either as given or with its
/// symbolic links resolved. Always so unless `BUN_TEST_INPUT_RECORD_ROOT` says otherwise.
pub fn root_holds_project(vm: &VirtualMachine) -> bool {
    let root = record_root(vm);
    let top = Root::new(vm.top_level_dir());
    [&*top.given, &*top.real]
        .into_iter()
        .any(|top| root.relative(top).is_some())
}

fn install_root(top: &[u8]) -> Option<&[u8]> {
    const MARKS: [&[u8]; 6] = [
        b"bun.lock",
        b"bun.lockb",
        b"pnpm-lock.yaml",
        b"pnpm-workspace.yaml",
        b"yarn.lock",
        b"package-lock.json",
    ];
    let mut dir = top
        .strip_suffix(&[bun_paths::SEP])
        .filter(|it| !it.is_empty())
        .unwrap_or(top);
    loop {
        for mark in MARKS {
            let mut path = dir.to_vec();
            if !path.last().is_some_and(|&c| bun_paths::is_sep(c)) {
                path.push(bun_paths::SEP);
            }
            path.extend_from_slice(mark);
            if bun_sys::exists(&path) {
                return Some(dir);
            }
        }
        dir = bun_paths::dirname(dir).filter(|it| *it != dir && !it.is_empty())?;
    }
}

/// When recording, the number of the current file (0 between files): asked on the JS thread when an async
/// transpile is scheduled, and handed back to [`did_hash_source`] when it completes.
pub fn recording_token(vm: &VirtualMachine) -> Option<u32> {
    let state = recorder_of(vm)?.state.borrow();
    Some(if state.file.is_some() {
        state.file_number
    } else {
        0
    })
}

/// SHA-256 of the bytes given to the transpiler; safe on the transpiler pool's threads.
pub fn source_hash(contents: &[u8]) -> [u8; 32] {
    let mut sha256 = [0u8; 32];
    bun_sha_hmac::sha::hashers::SHA256::hash(contents, &mut sha256);
    sha256
}

pub fn write_hex(out: &mut Vec<u8>, bytes: &[u8]) {
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
}

fn recorder_of(vm: &VirtualMachine) -> Option<&TestInputRecorder> {
    vm.test_isolation_state.input_recorder.get().map(|it| &**it)
}

pub type InputRecorderCell = OnceCell<Box<TestInputRecorder>>;

pub struct PendingResolve<'a> {
    recording: Option<(&'a TestInputRecorder, Question)>,
}

struct Question {
    specifier: Box<[u8]>,
    importer: Box<[u8]>,
    importer_is_file: bool,
    kind: &'static str,
    paths: Vec<Box<[u8]>>,
}

/// At the start of `VirtualMachine::resolve_maybe_needs_trailing_slash`.
pub fn will_resolve<'a>(
    global: &'a JSGlobalObject,
    specifier: &BunString,
    source: &BunString,
    mode: ResolveMode,
    importer_is_file: bool,
) -> PendingResolve<'a> {
    let vm = global.bun_vm();
    let Some(recorder) = recorder_of(vm) else {
        return PendingResolve { recording: None };
    };
    let mut state = recorder.state.borrow_mut();
    if state.file.is_none() {
        state.unattributed += 1;
        return PendingResolve { recording: None };
    }
    state.open.push(None);
    let paths = vm
        .transpiler
        .get()
        .resolver
        .custom_dir_paths
        .map(|paths| {
            paths
                .iter()
                .map(|it| Box::from(it.to_utf8().slice()))
                .collect()
        })
        .unwrap_or_default();
    PendingResolve {
        recording: Some((
            recorder,
            Question {
                specifier: Box::from(specifier.to_utf8().slice()),
                importer: Box::from(source.to_utf8().slice()),
                importer_is_file,
                kind: kind_of(mode),
                paths,
            },
        )),
    }
}

fn kind_of(mode: ResolveMode) -> &'static str {
    match mode {
        ResolveMode::Esm => "import",
        ResolveMode::Require => "require",
        ResolveMode::RequireResolve => "require-resolve",
        ResolveMode::EsmResolve => "esm-resolve",
    }
}

impl PendingResolve<'_> {
    /// Passes `resolved` through.
    pub fn did_resolve(
        mut self,
        resolved: Result<BunString, JSValue>,
        by_plugin: bool,
    ) -> Result<BunString, JSValue> {
        let Some((recorder, question)) = self.recording.take() else {
            return resolved;
        };
        let mut state = recorder.state.borrow_mut();
        let found = state.open.pop().flatten();
        let answer = resolved.as_ref().ok().map(|it| it.to_utf8());
        let answer = answer.as_ref().map(|it| it.slice());
        let found = found.filter(|found| answer == Some(&*found.path));
        let line = recorder.resolution_line(&question, answer, by_plugin, found.as_ref());
        if let Some(file) = state.file.as_mut() {
            file.add_resolution(line, &question.importer, answer);
        }
        resolved
    }
}

impl Drop for PendingResolve<'_> {
    /// A resolution that ended without [`PendingResolve::did_resolve`] threw (a plugin's
    /// `onResolve`, or a termination): its question has no answer to check, so the record is not
    /// reusable. An import that finds nothing is an answer, not this.
    fn drop(&mut self) {
        if let Some((recorder, _)) = self.recording.take() {
            let mut state = recorder.state.borrow_mut();
            state.open.pop();
            if let Some(file) = state.file.as_mut() {
                file.mark(b"resolve-threw");
            }
        }
    }
}

/// In `VirtualMachine::_resolve`, with the resolver's answer to the innermost resolution.
pub fn did_find(vm: &VirtualMachine, result: &ResolverResult<'_>) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let mut state = recorder.state.borrow_mut();
    let Some(slot) = state.open.last_mut() else {
        return;
    };
    *slot = recorder.found(result);
}

/// A resolution made by calling the resolver itself: a preload, or the test file named on the
/// command line.
pub fn did_resolve_directly(
    vm: &VirtualMachine,
    kind: &'static str,
    specifier: &[u8],
    dir: &[u8],
    result: &ResolverResult<'_>,
) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let found = recorder.found(result);
    let question = Question {
        specifier: Box::from(specifier),
        importer: Box::from(dir),
        importer_is_file: false,
        kind,
        paths: Vec::new(),
    };
    let answer = found.as_ref().map(|found| &*found.path);
    let line = recorder.resolution_line(&question, answer, false, found.as_ref());
    let mut state = recorder.state.borrow_mut();
    match state.file.as_mut() {
        Some(file) => file.add_resolution(line, b"", answer),
        None => state.unattributed += 1,
    }
}

/// Where the transpiler has read a module's source: `contents` are the bytes it transpiles.
pub fn did_read_source(
    vm: &VirtualMachine,
    path: &[u8],
    loader: Loader,
    contents: &[u8],
    is_virtual: bool,
) {
    if let Some(token) = recording_token(vm) {
        did_hash_source(vm, token, path, loader, source_hash(contents), is_virtual);
    }
}

/// An async transpile hashed its source on the pool thread; this records it on the JS thread when the job completes.
pub fn did_hash_source(
    vm: &VirtualMachine,
    token: u32,
    path: &[u8],
    loader: Loader,
    sha256: [u8; 32],
    is_virtual: bool,
) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let path = module_file(path);
    let mut state = recorder.state.borrow_mut();
    match state.sources.get_mut(path) {
        Some(source) => {
            source.changed_during_run |= source.sha256 != sha256;
            source.sha256 = sha256;
            source.loader = loader;
            source.is_virtual = is_virtual;
        }
        None => {
            let source = Source {
                sha256,
                loader,
                is_virtual,
                changed_during_run: false,
            };
            bun_core::handle_oom(state.sources.put(path, source));
        }
    }
    if state.file.is_some() && token == state.file_number {
        state.note_module(path, false);
    } else if let Some(file) = state.file.as_mut() {
        file.late_from_earlier_files += 1;
    } else {
        state.unattributed += 1;
    }
}

/// Whether a VM of this process records: read by `IsolatedModuleCache::lookup`, so a cache hit
/// calls into the recorder only then.
#[unsafe(no_mangle)]
pub static Bun__TestInputRecorder__enabled: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);

/// `IsolatedModuleCache::lookup` found a provider for `key`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__TestInputRecorder__didServeCachedSource(
    vm: &VirtualMachine,
    key: &BunString,
) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let key = key.to_utf8();
    recorder
        .state
        .borrow_mut()
        .note_module(module_file(key.slice()), true);
}

/// The file a module key loads: the key without its query. A specifier with a query (`?raw`, `?url`)
/// is loaded from the file without it, and its key keeps the query; the original of a mocked module
/// is loaded under the file's path with `?actual` (or `&actual`, then maybe `&spy`; see
/// `withoutOriginalModuleQuery` in `BunPlugin.cpp`). Either way the source is the file's bytes, so it
/// is the same input as the plain import; how the query changes the loader is in the question,
/// whose specifier carries it. A file whose name has a `?` in it gets the hash of another path,
/// which makes its record never hold: a rerun, not a miss.
fn module_file(key: &[u8]) -> &[u8] {
    match bun_core::strings::index_of_char_usize(key, b'?') {
        Some(query) => &key[..query],
        None => key,
    }
}

/// The current file did something whose effect a record can't replay, such as spawning a process:
/// its record names it and is not reused.
pub fn mark(vm: &VirtualMachine, name: &[u8]) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let mut state = recorder.state.borrow_mut();
    match state.file.as_mut() {
        Some(file) => file.mark(name),
        None => state.unattributed += 1,
    }
}

/// Whether this VM records, so a hook can skip work that only recording needs.
pub fn is_recording(vm: &VirtualMachine) -> bool {
    recorder_of(vm).is_some()
}

/// The current file's own code looks at `path` (absolute, or relative to the working directory now)
/// the way `look` says. Called on the JS thread when the call is made, also for async calls, so the
/// file that started the work is the one credited; a look while no file is current makes the next
/// record not reusable.
pub fn own_read(vm: &VirtualMachine, look: Look, path: &[u8]) {
    own_read_with(vm, look, path, b"");
}

/// [`own_read`] with what else the look needs, such as a glob's pattern.
pub fn own_read_with(vm: &VirtualMachine, look: Look, path: &[u8], extra: &[u8]) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let path = joined_now(path);
    let mut state = recorder.state.borrow_mut();
    match state.file.as_mut() {
        Some(file) => {
            file.settle();
            if !file.own.read(&recorder.root, look, &path, extra) {
                file.mark(b"link-loop");
            }
        }
        None => state.unattributed += 1,
    }
}

/// What one call writes, for [`own_wrote`] to apply when it succeeded. Made when the call is made:
/// paths are absolute then, and what the file looked at there is observed then.
pub struct OwnWrites {
    /// The number of the file that made the call; 0 between files.
    file: u32,
    effects: Vec<OwnEffect>,
    /// The making file's count of calls in flight, counted down when this is dropped.
    in_flight: Option<std::sync::Arc<core::sync::atomic::AtomicU32>>,
}

impl Drop for OwnWrites {
    fn drop(&mut self) {
        if let Some(count) = &self.in_flight {
            count.fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
        }
    }
}

// SAFETY: plain data, made and applied on the JS thread of the VM that records.
unsafe impl crate::job::JsAffine for OwnWrites {}

enum OwnEffect {
    Wrote(Box<[u8]>, Wrote),
    /// `fs.mkdtemp`: the directory it returns is new.
    Created,
}

impl OwnWrites {
    /// `None` when not recording.
    pub fn new(vm: &VirtualMachine) -> Option<OwnWrites> {
        let state = recorder_of(vm)?.state.borrow();
        let in_flight = state.file.as_ref().map(|file| {
            file.in_flight
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            std::sync::Arc::clone(&file.in_flight)
        });
        Some(OwnWrites {
            file: if in_flight.is_some() {
                state.file_number
            } else {
                0
            },
            effects: Vec::new(),
            in_flight,
        })
    }

    /// The call is about to write `path` as `wrote` says: what the file looked at there is observed
    /// now, and the write's effect waits for the call to succeed.
    pub fn write(&mut self, vm: &VirtualMachine, path: &[u8], wrote: Wrote) {
        let Some(recorder) = recorder_of(vm) else {
            return;
        };
        let path = absolute_now(path);
        if let Some(file) = recorder.state.borrow_mut().file.as_mut() {
            file.own.before_write(&recorder.root, &path);
        }
        self.effects
            .push(OwnEffect::Wrote(path.into_boxed_slice(), wrote));
    }

    /// The call puts a tree at `path` (an archive extracted there): [`Self::write`] with
    /// [`Wrote::Tree`], except into a directory that is there and is not the file's product, where
    /// the tree merges with what was there, which stays an input ([`Wrote::Merge`]).
    pub fn write_tree(&mut self, vm: &VirtualMachine, path: &[u8]) {
        let merges = !own_generated(vm, path)
            && bun_sys::stat(&bun_core::ZBox::from_vec(absolute_now(path))).is_ok_and(|st| {
                st.st_mode as u32 & bun_sys::S::IFMT as u32 == bun_sys::S::IFDIR as u32
            });
        self.write(vm, path, if merges { Wrote::Merge } else { Wrote::Tree });
    }

    /// The call is `fs.mkdtemp`: the directory it returns is the file's product.
    pub fn created(&mut self) {
        self.effects.push(OwnEffect::Created);
    }
}

/// The call that made `writes` succeeded, returning `returned` if it returns a path: its effects
/// apply, if the file that made it is still the current one. A failed call, or one that completes
/// after its file, leaves what it wrote an input of whatever reads it.
pub fn own_wrote(vm: &VirtualMachine, writes: OwnWrites, returned: Option<&[u8]>) {
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let mut state = recorder.state.borrow_mut();
    if writes.file == 0 || writes.file != state.file_number {
        return;
    }
    let Some(file) = state.file.as_mut() else {
        return;
    };
    file.apply(writes, returned);
}

/// [`own_wrote`] for a call that returns `promise`: its effects apply once the promise is
/// fulfilled. One that is rejected leaves what it wrote an input of whatever reads it. One still
/// pending when the file ends marks the record `pending-write`, so it does not hold: what the write
/// leaves is not known when the record is written. Whether it is fulfilled is asked when the file next looks at a path,
/// so a look after an `await` of the call sees its effects.
pub fn own_wrote_when_fulfilled(vm: &VirtualMachine, writes: OwnWrites, promise: JSValue) {
    use crate::js_promise::Status;
    let Some(recorder) = recorder_of(vm) else {
        return;
    };
    let Some(any) = promise.as_any_promise() else {
        return;
    };
    match any.status() {
        Status::Fulfilled => own_wrote(vm, writes, None),
        Status::Rejected => {}
        Status::Pending => {
            let mut state = recorder.state.borrow_mut();
            if writes.file == 0 || writes.file != state.file_number {
                return;
            }
            if let Some(file) = state.file.as_mut() {
                file.pending
                    .push((crate::Strong::create(promise, vm.global()), writes));
            }
        }
    }
}

/// Whether what is at `path` now is the current file's own product.
pub fn own_generated(vm: &VirtualMachine, path: &[u8]) -> bool {
    let Some(recorder) = recorder_of(vm) else {
        return false;
    };
    let path = absolute_now(path);
    let mut state = recorder.state.borrow_mut();
    state.file.as_mut().is_some_and(|file| {
        file.settle();
        file.own.generated(&path)
    })
}

/// Looks at a path again the way a record says it was looked at, for validation.
pub fn observe_again(vm: &VirtualMachine, look: Look, path: &[u8], extra: &[u8]) -> Box<[u8]> {
    match recorder_of(vm) {
        Some(recorder) => crate::test_own_reads::observe(&recorder.root, look, path, extra),
        None => crate::test_own_reads::observe(&record_root(vm), look, path, extra),
    }
}

/// `path` made absolute against the working directory as it is now, without `.` and `..`: a `..` is
/// taken where the kernel's walk takes it, which after a symbolic link is not where folding the
/// text puts it.
fn absolute_now(path: &[u8]) -> Vec<u8> {
    crate::test_own_reads::walked(&joined_now(path))
}

/// `path` made absolute against the working directory as it is now. Without `..` it is also
/// without `.`; one with a `..` is kept for [`OwnReads::read`] to walk.
fn joined_now(path: &[u8]) -> Vec<u8> {
    let joined = if bun_paths::is_absolute(path) {
        path.to_vec()
    } else {
        let mut buf = bun_paths::path_buffer_pool::get();
        match bun_sys::getcwd_z(&mut *buf) {
            Ok(cwd) => {
                let mut out = cwd.as_bytes().to_vec();
                if !out.last().is_some_and(|&c| bun_paths::is_sep(c)) {
                    out.push(bun_paths::SEP);
                }
                out.extend_from_slice(path);
                out
            }
            Err(_) => return path.to_vec(),
        }
    };
    if crate::test_own_reads::has_dotdot(&joined) {
        return joined;
    }
    bun_paths::Path::resolve(&[&joined[..]]).as_bytes().to_vec()
}

/// [`mark`] on the VM of this thread, for code that has none at hand.
pub fn mark_current(name: &[u8]) {
    if let Some(vm) = VirtualMachine::get_or_null() {
        mark(vm, name);
    }
}

/// [`mark`] from C++; `name` is a string literal.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__TestInputRecorder__mark(vm: &VirtualMachine, name: *const c_char) {
    // SAFETY: the callers pass a NUL-terminated literal.
    mark(vm, unsafe { CStr::from_ptr(name) }.to_bytes());
}

impl State {
    fn note_module(&mut self, path: &[u8], cached: bool) {
        let Some(file) = self.file.as_mut() else {
            self.unattributed += 1;
            return;
        };
        if !bun_paths::is_absolute(path) {
            // A module that is no file (a plugin's `namespace:path`, or anything else without a
            // path) can't be hashed again, so the record is not reusable. Builtins load no source.
            let builtin = path.starts_with(b"node:") || path.starts_with(b"bun:");
            if !builtin {
                file.mark(b"module-without-file");
            }
            return;
        }
        file.settle();
        if !file.module_index.contains_key(path) && file.own.generated(path) {
            file.generated += 1;
            return;
        }
        match file.module_index.get(path) {
            Some(&index) => file.modules[index].1 &= cached,
            None => {
                bun_core::handle_oom(file.module_index.put(path, file.modules.len()));
                file.modules.push((Box::from(path), cached));
            }
        }
    }
}

impl FileState {
    fn mark(&mut self, name: &[u8]) {
        if !self.marks.iter().any(|it| &**it == name) {
            self.marks.push(Box::from(name));
        }
    }

    fn apply(&mut self, mut writes: OwnWrites, returned: Option<&[u8]>) {
        for effect in core::mem::take(&mut writes.effects) {
            match effect {
                OwnEffect::Wrote(path, wrote) => self.own.wrote(&path, wrote),
                OwnEffect::Created => {
                    if let Some(path) = returned {
                        self.own.created(&absolute_now(path));
                    }
                }
            }
        }
    }

    /// Applies the effects of the pending writes whose promise is fulfilled by now, and forgets the
    /// rejected ones.
    fn settle(&mut self) {
        use crate::js_promise::Status;
        if self.pending.is_empty() {
            return;
        }
        let mut i = 0;
        while i < self.pending.len() {
            let status = self.pending[i]
                .0
                .get()
                .as_any_promise()
                .map_or(Status::Rejected, |it| it.status());
            match status {
                Status::Pending => i += 1,
                Status::Fulfilled => {
                    let (_, writes) = self.pending.remove(i);
                    self.apply(writes, None);
                }
                Status::Rejected => {
                    self.pending.remove(i);
                }
            }
        }
    }

    /// A question asked from a module the file's own code wrote, or answered by one, is left out:
    /// that module is the product of the file's code and recorded inputs, and its path may never
    /// exist again (a temporary directory), so the question can't be asked again. What such a
    /// question reaches that the file did not write is still an answer file, hashed.
    fn add_resolution(&mut self, line: (Box<[u8]>, Entry), importer: &[u8], answer: Option<&[u8]>) {
        self.settle();
        let own = &self.own;
        let generated = |path: &[u8]| bun_paths::is_absolute(path) && own.generated(path);
        let answer_generated = answer.is_some_and(generated);
        if generated(importer) || answer_generated {
            self.generated += 1;
            if let Some(answer) =
                answer.filter(|it| bun_paths::is_absolute(it) && !answer_generated)
                && !self.seen_answers.contains_key(answer)
            {
                bun_core::handle_oom(self.seen_answers.put(answer, ()));
                self.answers.push(Box::from(answer));
            }
            return;
        }
        if !self.seen_resolutions.contains_key(&*line.0) {
            bun_core::handle_oom(self.seen_resolutions.put(&line.0, ()));
            self.resolutions.push(line);
        }
        if let Some(answer) = answer.filter(|it| bun_paths::is_absolute(it))
            && !self.seen_answers.contains_key(answer)
        {
            bun_core::handle_oom(self.seen_answers.put(answer, ()));
            self.answers.push(Box::from(answer));
        }
    }
}

/// Counts of the reporter's summary, by name, at a point in the run.
pub type Counts = [(&'static str, u32); 6];

pub struct FileRecording<'a> {
    vm: &'a VirtualMachine,
    recording: Option<(&'a TestInputRecorder, Box<[u8]>, Counts)>,
}

/// At the start of `TestCommand::run`, before the test file is resolved.
pub fn will_run_file<'a>(
    vm: &'a VirtualMachine,
    file_name: &[u8],
    counts: &Counts,
) -> FileRecording<'a> {
    let Some(recorder) = recorder_of(vm) else {
        return FileRecording {
            vm,
            recording: None,
        };
    };
    let mut state = recorder.state.borrow_mut();
    let unattributed_before = core::mem::take(&mut state.unattributed);
    state.file_number += 1;
    state.file = Some(FileState {
        unattributed_before,
        ..Default::default()
    });
    FileRecording {
        vm,
        recording: Some((recorder, Box::from(file_name), *counts)),
    }
}

impl FileRecording<'_> {
    /// After the file's last test and hook, with the counts as they are now.
    pub fn did_run_file(mut self, file_path: &[u8], counts: &Counts) {
        if let Some((recorder, _, before)) = self.recording.take() {
            recorder.write_record(self.vm, file_path, Some((&before, counts)));
        }
    }
}

impl Drop for FileRecording<'_> {
    /// `TestCommand::run` returned early with an error: the record says so and has no outcome.
    fn drop(&mut self) {
        if let Some((recorder, file_name, _)) = self.recording.take() {
            recorder.write_record(self.vm, &file_name, None);
        }
    }
}

/// Where the record of the test file at `file_path` is; `None` when not recording.
pub fn record_path(vm: &VirtualMachine, file_path: &[u8]) -> Option<Vec<u8>> {
    Some(recorder_of(vm)?.record_path(file_path))
}

/// The record directory; `None` when not recording.
pub fn record_dir(vm: &VirtualMachine) -> Option<&[u8]> {
    Some(&recorder_of(vm)?.dir)
}

/// The fingerprint of this run; `None` when not recording.
pub fn fingerprint_hash(vm: &VirtualMachine) -> Option<[u8; 32]> {
    Some(recorder_of(vm)?.fingerprint_hash)
}

/// A path as records write it: relative to the root when under it.
pub fn written_path(vm: &VirtualMachine, path: &[u8]) -> Option<Box<[u8]>> {
    Some(recorder_of(vm)?.written(path).0)
}

/// Closes this process's segment of the store, so a merge in this process can take it.
pub fn close_segment(vm: &VirtualMachine) {
    if let Some(recorder) = recorder_of(vm) {
        recorder.segment.borrow_mut().take();
    }
}

/// The fingerprint of this run as records write it; `None` when not recording.
pub fn fingerprint_hex(vm: &VirtualMachine) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(64);
    write_hex(&mut out, &recorder_of(vm)?.fingerprint_hash);
    Some(out)
}

/// The fingerprint text records carry; `None` when not recording.
pub fn fingerprint_text(vm: &VirtualMachine) -> Option<&[u8]> {
    Some(&recorder_of(vm)?.fingerprint)
}

/// A path as a record writes it, made absolute again: relative ones are under the record root.
pub fn from_root(vm: &VirtualMachine, path: &[u8]) -> Vec<u8> {
    let mut out = match recorder_of(vm) {
        Some(recorder) => recorder.root.given.to_vec(),
        None => record_root(vm).given.into_vec(),
    };
    match path {
        b"." => {}
        b"./" => out.push(bun_paths::SEP),
        _ => {
            if !out.last().is_some_and(|&c| bun_paths::is_sep(c)) {
                out.push(bun_paths::SEP);
            }
            out.extend_from_slice(path);
        }
    }
    out
}

/// What a package with the "aot" condition says about JSX, decorators and class fields of the
/// TypeScript file at `path`, which both transpile paths put in place of the run's options
/// (`ParseOptions::apply_aot_package_config`). The resolver's result does not carry it. `None`
/// when no such package config applies, which is always so without the "aot" condition.
pub fn aot_config_check(vm: &VirtualMachine, path: &[u8]) -> Option<[u8; 32]> {
    let own = vm
        .transpiler
        .with_mut(|t| t.resolver.aot_package_config(path))?;
    let jsx = own.merge_jsx(bun_bundler::options_impl::jsx::Pragma {
        development: vm.transpiler.get().options.jsx.development,
        ..Default::default()
    });
    let text = format!(
        "{jsx:?}|{}|{}|{:?}",
        own.emit_decorator_metadata, own.experimental_decorators, own.use_define_for_class_fields
    );
    Some(source_hash(text.as_bytes()))
}

/// A recorded question with its paths made absolute again.
pub struct Asked<'a> {
    pub kind: &'a [u8],
    pub specifier: &'a [u8],
    pub importer: &'a [u8],
    pub importer_is_file: bool,
    pub paths: &'a [Box<[u8]>],
}

/// Asks the resolver `asked` again, the way it was asked while recording but without plugins, and
/// returns the `check` of the answer as a record would write it. `None` when it can't be asked again.
/// Holds the API lock: a failed resolution makes an error object.
pub fn check_again(vm: &VirtualMachine, asked: &Asked<'_>) -> Option<[u8; 32]> {
    let recorder = recorder_of(vm)?;
    let mut part = Vec::with_capacity(256);
    match asked.kind {
        b"entry" | b"preload" => {
            let mut log = bun_ast::Log::default();
            let prev_log = vm.transpiler.get().log;
            vm.transpiler.with_mut(|t| t.set_log(&raw mut log));
            scopeguard::defer! {
                vm.transpiler.with_mut(|t| t.set_log(prev_log));
            }
            let found = if asked.kind == b"entry" {
                let dot_slash = OnceCell::new();
                match vm
                    .transpiler
                    .with_mut(|t| t.resolve_entry_point(asked.specifier, &dot_slash))
                {
                    Ok(result) => recorder.found(&result),
                    Err(_) => None,
                }
            } else {
                let global_cache = if vm.standalone_module_graph.is_none() {
                    bun_resolver::GlobalCache::read_only
                } else {
                    bun_resolver::GlobalCache::disable
                };
                match vm.transpiler.with_mut(|t| {
                    t.resolver.resolve_and_auto_install(
                        asked.importer,
                        asked.specifier,
                        bun_ast::ImportKind::Stmt,
                        global_cache,
                    )
                }) {
                    bun_resolver::ResultUnion::Success(result) => recorder.found(&result),
                    _ => None,
                }
            };
            let answer = found.as_ref().map(|found| &*found.path);
            recorder.write_answer(&mut part, answer, false, found.as_ref());
        }
        kind => {
            let mode = match kind {
                b"import" => ResolveMode::Esm,
                b"require" => ResolveMode::Require,
                b"require-resolve" => ResolveMode::RequireResolve,
                b"esm-resolve" => ResolveMode::EsmResolve,
                _ => return None,
            };
            let global = vm.global();
            let specifier = BunString::clone_utf8(asked.specifier);
            let importer = BunString::clone_utf8(asked.importer);
            let paths: Vec<BunString> = asked
                .paths
                .iter()
                .map(|it| BunString::clone_utf8(it))
                .collect();
            if !paths.is_empty() {
                // SAFETY: `paths` outlives the resolution below; the slot is cleared after it.
                let paths = unsafe { bun_ptr::detach_lifetime(&paths[..]) };
                vm.transpiler
                    .with_mut(|t| t.resolver.custom_dir_paths = Some(paths));
            }
            recorder.state.borrow_mut().open.push(None);
            let global_cache = vm.transpiler.get().resolver.opts.global_cache;
            let resolved = if asked.importer_is_file {
                VirtualMachine::resolve_without_on_resolve::<true>(
                    global,
                    &specifier,
                    &importer,
                    None,
                    mode,
                    global_cache,
                )
            } else {
                VirtualMachine::resolve_without_on_resolve::<false>(
                    global,
                    &specifier,
                    &importer,
                    None,
                    mode,
                    global_cache,
                )
            };
            let found = recorder.state.borrow_mut().open.pop().flatten();
            vm.transpiler
                .with_mut(|t| t.resolver.custom_dir_paths = None);
            let answer = match resolved {
                Ok(Ok(answer)) => Some(answer),
                Ok(Err(_)) => None,
                Err(_) => {
                    global.clear_exception();
                    return None;
                }
            };
            let answer = answer.as_ref().map(|it| it.to_utf8());
            let answer = answer.as_ref().map(|it| it.slice());
            let found = found.filter(|found| answer == Some(&*found.path));
            recorder.write_answer(&mut part, answer, false, found.as_ref());
        }
    }
    Some(source_hash(&part))
}

impl TestInputRecorder {
    fn found(&self, result: &ResolverResult<'_>) -> Option<Found> {
        let path = result.path_const()?.text;
        let mut json = Vec::with_capacity(128);
        let _ = write!(
            json,
            ",\"moduleType\":\"{:?}\",\"flags\":{}",
            result.module_type,
            result.flags.bits()
        );
        if let Some(package_json) = result.package_json {
            json.extend_from_slice(b",\"packageJson\":");
            self.write_path(&mut json, package_json.source.path.text);
        }
        Some(Found {
            path: Box::from(path),
            json: json.into_boxed_slice(),
        })
    }

    /// One entry of `resolutions`: the question, the answer with its details, and the `check` of the
    /// answer; as JSON, and as the store keeps it.
    fn resolution_line(
        &self,
        question: &Question,
        answer: Option<&[u8]>,
        by_plugin: bool,
        found: Option<&Found>,
    ) -> (Box<[u8]>, Entry) {
        let mut line = Vec::with_capacity(320);
        self.write_question(&mut line, question);
        let start = line.len();
        self.write_answer(&mut line, answer, by_plugin, found);
        let check = source_hash(&line[start..]);
        line.extend_from_slice(b",\"check\":\"");
        write_hex(&mut line, &check);
        line.extend_from_slice(b"\"}");
        let (specifier, specifier_from_root) = self.written(&question.specifier);
        let (importer, importer_from_root) = self.written(&question.importer);
        let flags = if question.importer_is_file {
            store::IMPORTER_IS_FILE
        } else {
            0
        } | if specifier_from_root {
            store::SPECIFIER_FROM_ROOT
        } else {
            0
        } | if importer_from_root {
            store::IMPORTER_FROM_ROOT
        } else {
            0
        } | if by_plugin { store::PLUGIN } else { 0 };
        let entry = Entry::Resolution {
            flags,
            kind: Box::from(question.kind.as_bytes()),
            specifier,
            importer,
            paths: question.paths.iter().map(|it| self.written(it)).collect(),
            check: Some(check),
        };
        (line.into_boxed_slice(), entry)
    }

    /// A path as records write it, and whether it was made relative to the root.
    fn written(&self, path: &[u8]) -> (Box<[u8]>, bool) {
        match self.relative(path) {
            Some(relative) => (Box::from(relative), true),
            None => (Box::from(path), false),
        }
    }

    fn write_answer(
        &self,
        out: &mut Vec<u8>,
        answer: Option<&[u8]>,
        by_plugin: bool,
        found: Option<&Found>,
    ) {
        out.extend_from_slice(b",\"answer\":");
        match answer {
            Some(path) => {
                self.write_path(out, path);
            }
            None => out.extend_from_slice(b"null"),
        }
        if by_plugin {
            out.extend_from_slice(b",\"plugin\":true");
        }
        if let Some(found) = found {
            out.extend_from_slice(&found.json);
        }
    }

    fn write_question(&self, out: &mut Vec<u8>, question: &Question) {
        out.extend_from_slice(b"{\"specifier\":");
        let specifier_from_root = self.write_path(out, &question.specifier);
        out.extend_from_slice(b",\"importer\":");
        let importer_from_root = self.write_path(out, &question.importer);
        let _ = write!(out, ",\"kind\":\"{}\"", question.kind);
        if !question.importer_is_file {
            out.extend_from_slice(b",\"importerIsDir\":true");
        }
        if specifier_from_root {
            out.extend_from_slice(b",\"specifierFromRoot\":true");
        }
        if importer_from_root {
            out.extend_from_slice(b",\"importerFromRoot\":true");
        }
        if !question.paths.is_empty() {
            let mut from_root = Vec::new();
            out.extend_from_slice(b",\"paths\":[");
            for (i, path) in question.paths.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                if self.write_path(out, path) {
                    from_root.push(i);
                }
            }
            out.push(b']');
            if !from_root.is_empty() {
                out.extend_from_slice(b",\"pathsFromRoot\":[");
                for (n, i) in from_root.iter().enumerate() {
                    let _ = write!(out, "{}{i}", if n > 0 { "," } else { "" });
                }
                out.push(b']');
            }
        }
    }

    /// Inside the root, relative to it; elsewhere as it is. Whether it was made relative.
    fn write_path(&self, out: &mut Vec<u8>, path: &[u8]) -> bool {
        let relative = self.relative(path);
        let _ = write!(
            out,
            "{}",
            bun_core::fmt::format_json_string_utf8(relative.unwrap_or(path), Default::default())
        );
        relative.is_some()
    }

    /// The root itself is `.`, and `./` with a separator after it.
    fn relative<'p>(&self, path: &'p [u8]) -> Option<&'p [u8]> {
        self.root.relative(path)
    }

    fn write_record(
        &self,
        vm: &VirtualMachine,
        file_path: &[u8],
        counts: Option<(&Counts, &Counts)>,
    ) {
        let Some(mut file) = self.state.borrow_mut().file.take() else {
            return;
        };
        file.settle();
        // A write still under way when the file ends, a pending `Bun.write` or an async `node:fs`
        // call not completed yet, may land before or after the looks below, and a reused file
        // would not make it: its record must not hold, whatever the timing.
        if file.in_flight.load(core::sync::atomic::Ordering::Relaxed) != 0 {
            file.mark(b"pending-write");
        }
        let mut own = core::mem::take(&mut file.own);
        own.finish(&self.root);
        // What the file read was changed before it was observed, by another process or a file in
        // another worker: the values below may not be what the file saw.
        if own.changed {
            file.mark(b"changed-during-run");
        }
        // An answer that was never loaded, such as an `import()` the file did not wait for: hashed as it is now.
        let answers: Vec<(&[u8], Option<[u8; 32]>)> = (file.answers.iter())
            .filter(|answer| !file.module_index.contains_key(&***answer))
            .map(|answer| {
                let contents = bun_sys::File::read_from(bun_sys::Fd::cwd(), answer).ok();
                (&**answer, contents.map(|it| source_hash(&it)))
            })
            .collect();
        let aot: Vec<Option<[u8; 32]>> = (file.modules.iter())
            .map(|(path, _)| aot_config_check(vm, path))
            .collect();
        let outcome = counts.map(|(before, after)| {
            let mut out = [0u32; 6];
            for (out, ((_, before), (_, after))) in out.iter_mut().zip(before.iter().zip(after)) {
                *out = after.wrapping_sub(*before);
            }
            out
        });
        if bun_core::env_var::BUN_TEST_INPUT_RECORD_JSON
            .get_not_empty()
            .is_some_and(|it| it != b"0")
        {
            self.write_json(file_path, counts, &file, &own, &answers, &aot);
        }
        let state = self.state.borrow();
        let mut entries = Vec::with_capacity(
            file.resolutions.len() + file.modules.len() + answers.len() + own.reads.len(),
        );
        for ((path, _), aot) in file.modules.iter().zip(aot) {
            let source = state.sources.get(&**path);
            let flags = source.map_or(0, |source| {
                (if source.is_virtual { store::VIRTUAL } else { 0 })
                    | (if source.changed_during_run {
                        store::CHANGED_DURING_RUN
                    } else {
                        0
                    })
            });
            entries.push(Entry::Module {
                flags,
                path: self.written(path).0,
                sha256: source.map(|it| it.sha256),
                aot,
            });
        }
        drop(state);
        for (path, sha256) in answers {
            entries.push(Entry::Answer {
                path: self.written(path).0,
                sha256,
            });
        }
        for read in &own.reads {
            entries.push(Entry::Read {
                look: read.look.name(),
                path: self.written(&read.path).0,
                extra: read.extra.clone(),
                value: read.value.clone().unwrap_or_default(),
            });
        }
        entries.extend(file.resolutions.into_iter().map(|(_, entry)| entry));
        let header = store::Header {
            outcome,
            unattributed_before: file.unattributed_before,
            late_from_earlier_files: file.late_from_earlier_files,
            marks: file.marks,
        };
        let written_file = self.written(file_path).0;
        let new = store::NewState {
            file: &written_file,
            fingerprint: self.fingerprint_hash,
            header,
            entries: &entries,
        };
        let mut segment = self.segment.borrow_mut();
        let segment = segment.get_or_insert_with(|| match Segment::open(&self.dir) {
            Ok(segment) => Some(segment),
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><yellow>warn<r><d>:<r> test input records can't be written to {}: {}",
                    bstr::BStr::new(&self.dir),
                    err
                );
                None
            }
        });
        if let Some(segment) = segment
            && let Err(err) = segment.append(&new)
        {
            bun_core::pretty_errorln!(
                "<r><yellow>warn<r><d>:<r> the test input record of {} could not be written: {}",
                bstr::BStr::new(file_path),
                err
            );
        }
    }

    /// The record of one file as JSON, to read: `BUN_TEST_INPUT_RECORD_JSON=1`.
    fn write_json(
        &self,
        file_path: &[u8],
        counts: Option<(&Counts, &Counts)>,
        file: &FileState,
        own: &OwnReads,
        answers: &[(&[u8], Option<[u8; 32]>)],
        aot: &[Option<[u8; 32]>],
    ) {
        let state = self.state.borrow();
        let mut out = Vec::with_capacity(4096);
        let _ = write!(out, "{{\"version\":{RECORD_VERSION},\"file\":");
        self.write_path(&mut out, file_path);
        let _ = write!(
            out,
            ",\"root\":{},\"fingerprint\":\"",
            bun_core::fmt::format_json_string_utf8(&self.root.given, Default::default())
        );
        write_hex(&mut out, &self.fingerprint_hash);
        out.extend_from_slice(b"\",\"outcome\":");
        match counts {
            Some((before, after)) => {
                out.push(b'{');
                for (i, ((name, before), (_, after))) in before.iter().zip(after).enumerate() {
                    let comma = if i > 0 { "," } else { "" };
                    let delta = after.wrapping_sub(*before);
                    let _ = write!(out, "{comma}\"{name}\":{delta}");
                }
                out.push(b'}');
            }
            None => out.extend_from_slice(b"null,\"error\":true"),
        }
        let _ = write!(
            out,
            ",\"unattributedBefore\":{},\"lateFromEarlierFiles\":{},\"generated\":{},\"marks\":[",
            file.unattributed_before, file.late_from_earlier_files, file.generated
        );
        for (i, name) in file.marks.iter().enumerate() {
            let _ = write!(
                out,
                "{}{}",
                if i > 0 { "," } else { "" },
                bun_core::fmt::format_json_string_utf8(name, Default::default())
            );
        }
        out.extend_from_slice(b"],\"resolutions\":[");
        for (i, (line, _)) in file.resolutions.iter().enumerate() {
            out.extend_from_slice(if i > 0 { b",\n" } else { b"\n" });
            out.extend_from_slice(line);
        }
        out.extend_from_slice(b"],\"modules\":[");
        for (i, ((path, cached), aot)) in file.modules.iter().zip(aot).enumerate() {
            out.extend_from_slice(if i > 0 { b",\n" } else { b"\n" });
            out.extend_from_slice(b"{\"path\":");
            self.write_path(&mut out, path);
            match state.sources.get(&**path) {
                Some(source) => {
                    out.extend_from_slice(b",\"sha256\":\"");
                    write_hex(&mut out, &source.sha256);
                    let loader: &'static str = source.loader.into();
                    let _ = write!(out, "\",\"loader\":\"{loader}\"");
                    if source.is_virtual {
                        out.extend_from_slice(b",\"virtual\":true");
                    }
                    if source.changed_during_run {
                        out.extend_from_slice(b",\"changedDuringRun\":true");
                    }
                }
                None => out.extend_from_slice(b",\"sha256\":null"),
            }
            if let Some(own) = aot {
                out.extend_from_slice(b",\"aotConfig\":\"");
                write_hex(&mut out, own);
                out.push(b'"');
            }
            if *cached {
                out.extend_from_slice(b",\"cached\":true");
            }
            out.push(b'}');
        }
        out.extend_from_slice(b"],\"answerFiles\":[");
        for (i, (answer, sha256)) in answers.iter().enumerate() {
            out.extend_from_slice(if i > 0 { b",\n" } else { b"\n" });
            out.extend_from_slice(b"{\"path\":");
            self.write_path(&mut out, answer);
            match sha256 {
                Some(sha256) => {
                    out.extend_from_slice(b",\"sha256\":\"");
                    write_hex(&mut out, sha256);
                    out.extend_from_slice(b"\"}");
                }
                None => out.extend_from_slice(b",\"sha256\":null}"),
            }
        }
        out.extend_from_slice(b"],\"reads\":[");
        for (i, read) in own.reads.iter().enumerate() {
            out.extend_from_slice(if i > 0 { b",\n" } else { b"\n" });
            let _ = write!(out, "{{\"look\":\"{}\",\"path\":", read.look.name());
            self.write_path(&mut out, &read.path);
            if !read.extra.is_empty() {
                let _ = write!(
                    out,
                    ",\"extra\":{}",
                    bun_core::fmt::format_json_string_utf8(&read.extra, Default::default())
                );
            }
            let _ = write!(
                out,
                ",\"value\":{}}}",
                bun_core::fmt::format_json_string_utf8(
                    read.value.as_deref().unwrap_or(b""),
                    Default::default()
                )
            );
        }
        out.extend_from_slice(b"]}\n");
        drop(state);
        self.write_file(file_path, &out);
    }

    fn record_path(&self, file_path: &[u8]) -> Vec<u8> {
        let mut path = self.dir.to_vec();
        if !path.last().is_some_and(|&c| bun_paths::is_sep(c)) {
            path.push(bun_paths::SEP);
        }
        for &c in self.relative(file_path).unwrap_or(file_path) {
            match c {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => path.push(c),
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => path.push(c),
                _ => {
                    let _ = write!(path, "%{c:02X}");
                }
            }
        }
        path.extend_from_slice(b".json");
        path
    }

    fn write_file(&self, file_path: &[u8], text: &[u8]) {
        let path = self.record_path(file_path);
        let mut tmp = path.clone();
        let _ = write!(tmp, ".{}.tmp", std::process::id());
        let tmp = bun_sys::UnlinkOnDrop::new(bun_sys::Fd::cwd(), bun_core::ZBox::from_vec(tmp));
        let dest = bun_core::ZBox::from_vec(path);
        let flags =
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC;
        let result = bun_sys::File::make_open(tmp.as_bytes(), flags, 0o666)
            .and_then(|f| f.write_all(text))
            .and_then(|()| tmp.rename_to(bun_sys::Fd::cwd(), &dest));
        if let Err(err) = result {
            bun_core::Output::err(
                err,
                "failed to write the test input record <b>{}<r>",
                (bstr::BStr::new(dest.as_bytes()),),
            );
        }
    }
}
