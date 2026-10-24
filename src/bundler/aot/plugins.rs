use bun_aot::load::source_provider::{
    Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest,
};
use bun_ast::{Kind, Loader, Log, Msg, Range};
use bun_core::strings;
use bun_ptr::ParentRef;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_threading::{Condvar, Guarded};
use core::ptr::NonNull;
use std::borrow::Cow;

use super::options::in_memory_files_by_path;
use crate::BundleV2;
use crate::ParseTask;
use crate::bun_fs as Fs;
use crate::bundle_v2::api::JSBundler::{
    Load, LoadValue, MiniImportRecord, Plugin, RequestOwner, Resolve, ResolveValue,
};
use crate::options::Target;

const FILE_NAMESPACE: &[u8] = b"file";

#[derive(Default)]
struct WaiterState {
    has_deferred: bool,
    answer: Option<Answer>,
}

#[allow(clippy::large_enum_variant)]
enum Answer {
    Load(LoadValue),
    Resolve(ResolveValue),
    Drained,
}

#[allow(clippy::large_enum_variant)]
enum WakeReason {
    Answered(Answer),
    Deferred,
}

#[derive(Default)]
pub struct PluginWaiter {
    state: Guarded<WaiterState>,
    changed: Condvar,
}

impl PluginWaiter {
    pub fn defer(&self) {
        let mut state = self.state.lock();
        state.has_deferred = true;
        self.changed.broadcast();
    }

    pub(crate) fn answer_load(&self, value: LoadValue) {
        self.answer(Answer::Load(value));
    }

    pub(crate) fn answer_resolve(&self, value: ResolveValue) {
        self.answer(Answer::Resolve(value));
    }

    pub(crate) fn answer_drained(&self) {
        self.answer(Answer::Drained);
    }

    fn answer(&self, answer: Answer) {
        let mut state = self.state.lock();
        debug_assert!(state.answer.is_none());
        state.answer = Some(answer);
        // Still locked: once the sleeper has the answer, `shut_down` may free the waiter.
        self.changed.broadcast();
    }

    fn wait(&self) -> WakeReason {
        let mut state = self.state.lock();
        loop {
            if let Some(answer) = state.answer.take() {
                return WakeReason::Answered(answer);
            }
            if state.has_deferred {
                return WakeReason::Deferred;
            }
            self.changed.wait_guarded(&mut state);
        }
    }

    fn wait_for_answer(&self) -> Answer {
        let mut state = self.state.lock();
        loop {
            if let Some(answer) = state.answer.take() {
                return answer;
            }
            self.changed.wait_guarded(&mut state);
        }
    }
}

#[derive(Default)]
struct WaiterPool {
    #[expect(
        clippy::vec_box,
        reason = "requests in flight point at their waiter, so growing the list must not move it"
    )]
    all: Vec<Box<PluginWaiter>>,
    idle: Vec<NonNull<PluginWaiter>>,
}

impl WaiterPool {
    fn acquire(&mut self) -> NonNull<PluginWaiter> {
        if let Some(waiter) = self.idle.pop() {
            // SAFETY: `all` owns every waiter until the pool drops.
            *unsafe { waiter.as_ref() }.state.lock() = WaiterState::default();
            return waiter;
        }
        self.all.push(Box::default());
        NonNull::from(&mut **self.all.last_mut().expect("a waiter was just pushed"))
    }

    fn release(&mut self, waiter: NonNull<PluginWaiter>) {
        self.idle.push(waiter);
    }
}

struct PendingLoad {
    load: Box<Load>,
    task: Box<ParseTask>,
    path: Box<[u8]>,
    told_path: Box<[u8]>,
    namespace: Box<[u8]>,
    waiter: NonNull<PluginWaiter>,
}

impl PendingLoad {
    fn name(&self) -> (&[u8], &[u8]) {
        (&self.namespace, &self.path)
    }
}

struct PendingDeferredLoad {
    pending: PendingLoad,
    default_loader: Loader,
    file: Option<Cow<'static, [u8]>>,
}

pub(crate) struct PluginRequests {
    plugins: NonNull<Plugin>,
    post: Guarded<NonNull<BundleV2<'static>>>,
    waiters: Guarded<WaiterPool>,
    deferred: Guarded<Vec<PendingDeferredLoad>>,
    drain_waiter: Box<PluginWaiter>,
    // The bundler knows a file of `files` by its key as it is written, and that is what it tells plugins.
    written_keys: FxHashMap<Vec<u8>, Box<[u8]>>,
    specifiers_matched: ShardedMap<Vec<u8>, bool>,
    files_matched: ShardedMap<Vec<u8>, bool>,
}

// SAFETY: `plugins` never changes, and the one method called on it locks each filter itself.
// `drain_waiter` and the two memos are `Sync`. Every other field is reached only under its lock.
unsafe impl Send for PluginRequests {}
// SAFETY: as `Send`.
unsafe impl Sync for PluginRequests {}

impl PluginRequests {
    pub(crate) fn new(bundle: NonNull<BundleV2<'static>>) -> PluginRequests {
        // SAFETY: the caller owns the carrier, and no other thread has it yet.
        let carrier = unsafe { bundle.as_ref() };
        debug_assert!(carrier.completion.is_some());
        let working_directory = carrier.transpiler().fs().top_level_dir();
        let in_memory_files = carrier.file_map.into_iter();
        let in_memory_files =
            in_memory_files.flat_map(|files| in_memory_files_by_path(files, working_directory));
        PluginRequests {
            plugins: carrier.plugins.expect("plugin requests need plugins"),
            post: Guarded::new(bundle),
            waiters: Guarded::default(),
            deferred: Guarded::default(),
            drain_waiter: Box::default(),
            written_keys: (in_memory_files.map(|(path, (key, _))| (path, Box::from(key))))
                .collect(),
            specifiers_matched: ShardedMap::default(),
            files_matched: ShardedMap::default(),
        }
    }

    pub(crate) fn resolve(
        &self,
        request: &ResolveRequest<'_>,
        log: &mut Log,
    ) -> Result<Resolution, Failed> {
        if !self.has_resolve_plugin(request.specifier) {
            return Ok(Resolution::NotHandled);
        }

        let record = MiniImportRecord {
            kind: request.kind,
            source_file: (&*self.told_path(request.importer)).into(),
            namespace: FILE_NAMESPACE.into(),
            specifier: request.specifier.into(),
            importer_source_index: u32::MAX,
            import_record_index: 0,
            range: Range::NONE,
            original_target: Target::Bun,
            loader: None,
        };
        let waiter = self.waiters.lock().acquire();
        let resolve = self.with_bundle(|bundle| {
            let mut resolve = Box::new(Resolve::init(bundle, record));
            resolve.owner = RequestOwner::Waiter(waiter);
            resolve.dispatch();
            resolve
        });
        // SAFETY: the pool owns every waiter until `self` drops.
        let answer = unsafe { waiter.as_ref() }.wait_for_answer();
        drop(resolve);
        self.waiters.lock().release(waiter);

        match answer {
            Answer::Resolve(value) => resolution_from_value(value, log),
            Answer::Load(_) | Answer::Drained => {
                unreachable!("a resolve request gets a resolve answer")
            }
        }
    }

    // The filters are matched one thread at a time.
    fn has_resolve_plugin(&self, specifier: &[u8]) -> bool {
        if let Some(&is_matched) = self.specifiers_matched.get_ref(specifier) {
            return is_matched;
        }
        let path = Fs::Path::init_with_namespace(specifier, FILE_NAMESPACE);
        let is_matched = self.plugins().has_any_matches(&path, false);
        *self
            .specifiers_matched
            .insert_ref(specifier.to_vec(), is_matched)
    }

    fn told_path<'p>(&'p self, module: ModuleName<'p>) -> Cow<'p, [u8]> {
        if module.namespace != FILE_NAMESPACE {
            return Cow::Borrowed(module.path);
        }
        match self.written_keys.get(module.path) {
            Some(key) => Cow::Borrowed(&**key),
            None => with_separators_of_host(module.path, cfg!(windows)),
        }
    }

    pub(crate) fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        let told_path = self.told_path(module);
        let path = Fs::Path::init_with_namespace(&told_path, module.namespace);
        if module.namespace != FILE_NAMESPACE {
            return self.plugins().has_any_matches(&path, true);
        }
        if let Some(&is_matched) = self.files_matched.get_ref(module.path) {
            return is_matched;
        }
        let is_matched = self.plugins().has_any_matches(&path, true);
        *self
            .files_matched
            .insert_ref(module.path.to_vec(), is_matched)
    }

    pub(crate) fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        if !self.has_load_plugin(request.module) {
            return Ok(Loaded::from_file(
                (request.read_file)(),
                request.default_loader,
            ));
        }

        let pending = self.post_load(request);
        // SAFETY: the pool owns every waiter until `self` drops.
        match unsafe { pending.waiter.as_ref() }.wait() {
            WakeReason::Answered(answer) => {
                self.release_load(pending);
                loaded_from_value(
                    load_value(answer),
                    request.read_file,
                    request.default_loader,
                    log,
                )
            }
            WakeReason::Deferred => {
                let file = (request.read_file)();
                self.deferred.lock().push(PendingDeferredLoad {
                    pending,
                    default_loader: request.default_loader,
                    file,
                });
                Ok(Loaded::Deferred)
            }
        }
    }

    pub(crate) fn finish_deferred_loads(
        &self,
        log: &mut Log,
    ) -> Vec<(Vec<u8>, Vec<u8>, Result<Loaded, Failed>)> {
        let mut deferred = core::mem::take(&mut *self.deferred.lock());
        if deferred.is_empty() {
            return Vec::new();
        }
        self.drain_defer_promises();
        deferred.sort_unstable_by(|left, right| left.pending.name().cmp(&right.pending.name()));
        deferred
            .into_iter()
            .map(|entry| self.finish_deferred_load(entry, log))
            .collect()
    }

    pub(crate) fn shut_down(self) {
        let mut scratch = Log::init();
        let _ = self.finish_deferred_loads(&mut scratch);
    }

    fn plugins(&self) -> &Plugin {
        // SAFETY: the plugins outlive the build. `Plugin` is an opaque FFI type, so a shared
        // reference claims nothing about the bytes the JS thread changes.
        unsafe { self.plugins.as_ref() }
    }

    fn with_bundle<R>(&self, work: impl FnOnce(&mut BundleV2<'static>) -> R) -> R {
        let mut bundle = self.post.lock();
        // SAFETY: the carrier outlives `self`. The lock admits one posting thread at a time. A post
        // writes `drain_defer_task.waiter` alone, which no other thread touches before the hop is
        // posted, and otherwise reads fields that do not change while the build runs.
        work(unsafe { bundle.as_mut() })
    }

    fn post_load(&self, request: &LoadRequest<'_>) -> PendingLoad {
        let path: Box<[u8]> = request.module.path.into();
        let told_path: Box<[u8]> = (&*self.told_path(request.module)).into();
        let namespace: Box<[u8]> = request.module.namespace.into();
        // SAFETY: both boxes go into the `PendingLoad` that owns the task and are freed after it.
        // Moving a box does not move its bytes.
        let task_path =
            unsafe { Fs::Path::init_with_namespace(&told_path, &namespace).into_static() };
        let waiter = self.waiters.lock().acquire();
        self.with_bundle(|bundle| {
            let mut task = Box::new(ParseTask {
                path: task_path,
                ctx: Some(ParentRef::from_ref_mut(bundle)),
                known_target: Target::Bun,
                loader: Some(request.default_loader),
                ..Default::default()
            });
            let mut load = Box::new(Load::init(bundle, &mut task));
            load.owner = RequestOwner::Waiter(waiter);
            load.dispatch();
            PendingLoad {
                load,
                task,
                path,
                told_path,
                namespace,
                waiter,
            }
        })
    }

    fn release_load(&self, pending: PendingLoad) -> (Vec<u8>, Vec<u8>) {
        let PendingLoad {
            load,
            task,
            path,
            told_path,
            namespace,
            waiter,
        } = pending;
        drop(load);
        drop(task);
        drop(told_path);
        self.waiters.lock().release(waiter);
        (namespace.into_vec(), path.into_vec())
    }

    fn drain_defer_promises(&self) {
        debug_assert!(self.drain_waiter.state.lock().answer.is_none());
        let drain_waiter = NonNull::from_ref(self.drain_waiter.as_ref());
        self.with_bundle(|bundle| {
            debug_assert!(bundle.drain_defer_task.waiter.is_none());
            bundle.drain_defer_task.waiter = Some(drain_waiter);
            bundle.drain_defer_task.schedule();
        });
        match self.drain_waiter.wait_for_answer() {
            Answer::Drained => {}
            Answer::Load(_) | Answer::Resolve(_) => {
                unreachable!("the drain waiter belongs to no request")
            }
        }
    }

    fn finish_deferred_load(
        &self,
        entry: PendingDeferredLoad,
        log: &mut Log,
    ) -> (Vec<u8>, Vec<u8>, Result<Loaded, Failed>) {
        let PendingDeferredLoad {
            pending,
            default_loader,
            file,
        } = entry;
        // SAFETY: the pool owns every waiter until `self` drops.
        let value = load_value(unsafe { pending.waiter.as_ref() }.wait_for_answer());
        let (namespace, path) = self.release_load(pending);
        let loaded = loaded_from_value(value, || file, default_loader, log);
        (namespace, path, loaded)
    }
}

// The compiler writes `C:/a/b.ts`. The bundler tells a plugin `C:\a\b.ts`, and a filter may be written for that.
fn with_separators_of_host(path: &[u8], is_windows: bool) -> Cow<'_, [u8]> {
    if !is_windows || !strings::contains_char(path, b'/') {
        return Cow::Borrowed(path);
    }
    let to_backslash = |&byte: &u8| if byte == b'/' { b'\\' } else { byte };
    Cow::Owned(path.iter().map(to_backslash).collect())
}

fn load_value(answer: Answer) -> LoadValue {
    match answer {
        Answer::Load(value) => value,
        Answer::Resolve(_) | Answer::Drained => unreachable!("a load request gets a load answer"),
    }
}

fn resolution_from_value(value: ResolveValue, log: &mut Log) -> Result<Resolution, Failed> {
    match value {
        ResolveValue::NoMatch => Ok(Resolution::NotHandled),
        ResolveValue::Success(success) if success.external => Ok(Resolution::External {
            specifier: success.path.into_vec(),
        }),
        ResolveValue::Success(success) => Ok(Resolution::Module {
            namespace: if success.namespace.is_empty() {
                FILE_NAMESPACE.to_vec()
            } else {
                success.namespace.into_vec()
            },
            path: success.path.into_vec(),
        }),
        ResolveValue::Err(message) => {
            record_message(message, log)?;
            Ok(Resolution::NotHandled)
        }
        ResolveValue::Pending | ResolveValue::Consumed => {
            unreachable!("a resolve request is answered with a value")
        }
    }
}

fn loaded_from_value(
    value: LoadValue,
    read_file: impl FnOnce() -> Option<Cow<'static, [u8]>>,
    default_loader: Loader,
    log: &mut Log,
) -> Result<Loaded, Failed> {
    match value {
        LoadValue::Success(success) => Ok(Loaded::Source {
            contents: Cow::Owned(success.source_code.into_vec()),
            loader: success.loader,
            is_from_plugin: true,
        }),
        LoadValue::NoMatch => Ok(Loaded::from_file(read_file(), default_loader)),
        LoadValue::Err(message) => {
            record_message(message, log)?;
            Ok(Loaded::from_file(read_file(), default_loader))
        }
        LoadValue::Pending | LoadValue::Consumed => {
            unreachable!("a load request is answered with a value")
        }
    }
}

fn record_message(message: Msg, log: &mut Log) -> Result<(), Failed> {
    let kind = message.kind;
    log.msgs.push(message);
    log.errors += (kind == Kind::Err) as u32;
    log.warnings += (kind == Kind::Warn) as u32;
    if kind == Kind::Err {
        return Err(Failed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle_v2::api::JSBundler::{LoadSuccess, ResolveSuccess};
    use std::time::Duration;

    fn is_load_answer(reason: &WakeReason) -> bool {
        matches!(
            reason,
            WakeReason::Answered(Answer::Load(LoadValue::NoMatch))
        )
    }

    fn message(kind: Kind) -> Msg {
        Msg {
            kind,
            ..Default::default()
        }
    }

    fn counts(log: &Log) -> (u32, u32, usize) {
        (log.errors, log.warnings, log.msgs.len())
    }

    fn resolve_success(namespace: &[u8], external: bool) -> ResolveValue {
        ResolveValue::Success(ResolveSuccess {
            path: Box::from(&b"/p/a.ts"[..]),
            namespace: Box::from(namespace),
            external,
        })
    }

    fn file() -> Option<Cow<'static, [u8]>> {
        Some(Cow::Borrowed(b"from file"))
    }

    fn is_file_source(loaded: &Result<Loaded, Failed>) -> bool {
        matches!(
            loaded,
            Ok(Loaded::Source { contents, loader: Loader::Ts, is_from_plugin: false })
                if &**contents == b"from file"
        )
    }

    #[test]
    fn told_paths_have_the_separators_of_the_host() {
        assert_eq!(
            &*with_separators_of_host(b"C:/a/b.ts", true),
            b"C:\\a\\b.ts"
        );
        assert_eq!(&*with_separators_of_host(b"/a/b.ts", false), b"/a/b.ts");
    }

    #[test]
    fn answer_before_wait() {
        let waiter = PluginWaiter::default();
        waiter.answer_load(LoadValue::NoMatch);
        assert!(is_load_answer(&waiter.wait()));
    }

    #[test]
    fn answer_from_second_thread() {
        let waiter = PluginWaiter::default();
        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(10));
                waiter.answer_resolve(ResolveValue::NoMatch);
            });
            assert!(matches!(
                waiter.wait(),
                WakeReason::Answered(Answer::Resolve(ResolveValue::NoMatch))
            ));
        });
    }

    #[test]
    fn defer_then_answer() {
        let waiter = PluginWaiter::default();
        waiter.defer();
        assert!(matches!(waiter.wait(), WakeReason::Deferred));
        waiter.answer_load(LoadValue::NoMatch);
        assert!(matches!(
            waiter.wait_for_answer(),
            Answer::Load(LoadValue::NoMatch)
        ));
    }

    #[test]
    fn answer_wins_over_defer() {
        let waiter = PluginWaiter::default();
        waiter.defer();
        waiter.answer_load(LoadValue::NoMatch);
        assert!(is_load_answer(&waiter.wait()));
    }

    #[test]
    fn pool_reuses_clean_waiter() {
        let mut pool = WaiterPool::default();
        let first = pool.acquire();
        // SAFETY: the pool is alive.
        unsafe { first.as_ref() }.defer();
        // SAFETY: the pool is alive.
        unsafe { first.as_ref() }.answer_drained();
        pool.release(first);

        let second = pool.acquire();
        assert_eq!(first, second);
        assert_eq!(pool.all.len(), 1);
        // SAFETY: the pool is alive.
        let state = unsafe { second.as_ref() }.state.lock();
        assert!(!state.has_deferred);
        assert!(state.answer.is_none());
    }

    #[test]
    fn pool_creates_waiter_when_none_is_idle() {
        let mut pool = WaiterPool::default();
        let first = pool.acquire();
        let second = pool.acquire();
        assert_ne!(first, second);
        assert_eq!(pool.all.len(), 2);
    }

    #[test]
    fn defer_of_other_waiter_wakes_nobody() {
        let waiter = PluginWaiter::default();
        let other = PluginWaiter::default();
        std::thread::scope(|scope| {
            let sleeper = scope.spawn(|| is_load_answer(&waiter.wait()));
            other.defer();
            std::thread::sleep(Duration::from_millis(10));
            assert!(!sleeper.is_finished());
            waiter.answer_load(LoadValue::NoMatch);
            assert!(sleeper.join().unwrap());
        });
    }

    #[test]
    fn resolve_answers() {
        let mut log = Log::init();
        assert!(matches!(
            resolution_from_value(ResolveValue::NoMatch, &mut log),
            Ok(Resolution::NotHandled)
        ));
        assert!(matches!(
            resolution_from_value(resolve_success(b"virtual", false), &mut log),
            Ok(Resolution::Module { namespace, path })
                if namespace == b"virtual" && path == b"/p/a.ts"
        ));
        assert!(matches!(
            resolution_from_value(resolve_success(b"", false), &mut log),
            Ok(Resolution::Module { namespace, .. }) if namespace == FILE_NAMESPACE
        ));
        assert_eq!(counts(&log), (0, 0, 0));
    }

    #[test]
    fn external_answer_carries_plugin_path() {
        let mut log = Log::init();
        for namespace in [&b""[..], b"virtual"] {
            assert!(matches!(
                resolution_from_value(resolve_success(namespace, true), &mut log),
                Ok(Resolution::External { specifier }) if specifier == b"/p/a.ts"
            ));
        }
        assert_eq!(counts(&log), (0, 0, 0));
    }

    #[test]
    fn resolve_error_fails() {
        let mut log = Log::init();
        let value = ResolveValue::Err(message(Kind::Err));
        let answer = resolution_from_value(value, &mut log);
        assert!(answer.is_err());
        assert_eq!(counts(&log), (1, 0, 1));
    }

    #[test]
    fn resolve_warning_is_not_handled() {
        let mut log = Log::init();
        let value = ResolveValue::Err(message(Kind::Warn));
        let answer = resolution_from_value(value, &mut log);
        assert!(matches!(answer, Ok(Resolution::NotHandled)));
        assert_eq!(counts(&log), (0, 1, 1));
    }

    #[test]
    fn load_success_is_from_plugin() {
        let mut log = Log::init();
        let value = LoadValue::Success(LoadSuccess {
            source_code: Box::from(&b"from plugin"[..]),
            loader: Loader::Json,
        });
        let loaded = loaded_from_value(
            value,
            || unreachable!("an answered load reads no file"),
            Loader::Ts,
            &mut log,
        );
        assert!(matches!(
            loaded,
            Ok(Loaded::Source { contents, loader: Loader::Json, is_from_plugin: true })
                if &*contents == b"from plugin"
        ));
    }

    #[test]
    fn declined_load_reads_file() {
        let mut log = Log::init();
        let loaded = loaded_from_value(LoadValue::NoMatch, file, Loader::Ts, &mut log);
        assert!(is_file_source(&loaded));
        assert_eq!(counts(&log), (0, 0, 0));
    }

    #[test]
    fn declined_load_without_file_is_not_found() {
        let mut log = Log::init();
        let loaded = loaded_from_value(LoadValue::NoMatch, || None, Loader::Ts, &mut log);
        assert!(matches!(loaded, Ok(Loaded::NotFound)));
    }

    #[test]
    fn load_error_fails() {
        let mut log = Log::init();
        let loaded = loaded_from_value(
            LoadValue::Err(message(Kind::Err)),
            || unreachable!("a failed load reads no file"),
            Loader::Ts,
            &mut log,
        );
        assert!(loaded.is_err());
        assert_eq!(counts(&log), (1, 0, 1));
    }

    #[test]
    fn load_warning_reads_file() {
        let mut log = Log::init();
        let value = LoadValue::Err(message(Kind::Warn));
        let loaded = loaded_from_value(value, file, Loader::Ts, &mut log);
        assert!(is_file_source(&loaded));
        assert_eq!(counts(&log), (0, 1, 1));
    }
}
