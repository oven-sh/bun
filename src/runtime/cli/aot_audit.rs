use bun_ast::audited::{AuditedExpression, AuditedFile, AuditedParameter, AuditedValidation, PrintedAudit};
use bun_sema_driver::FxHashMap as HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use bun_threading::Guarded;

use crate::cli::check_command::{Audited, EntryPoint, MoreCode, audit_before};

struct Described {
    passes: u32,
    minimum: i32,
    maximum: i32,
    text: Box<str>,
}

struct File {
    audited: &'static AuditedFile,
    groups: HashMap<(u32, u32, i32), u32>,
    parameters: HashMap<(u32, u32), u32>,
}

#[derive(Default)]
struct State {
    files: HashMap<Vec<u8>, File>,
    described: Vec<Described>,
    shapes: HashMap<String, Box<str>>,
    generation: u32,
    awaits_whole_program_analysis: bool,
    entry_points: Vec<Vec<u8>>,
    code: Vec<Vec<u8>>,
    is_for_tests: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Confidence {
    Sure,
    Unsure,
    Silent,
}

impl Confidence {
    fn text(self) -> &'static str {
        match self {
            Confidence::Sure => "",
            Confidence::Unsure => "\"unsure\":true,",
            Confidence::Silent => "\"unsure\":true,\"silent\":true,",
        }
    }
}

static STATE: Guarded<Option<State>> = Guarded::new(None);
static IS_ANALYZING_WHOLE_PROGRAM: AtomicBool = AtomicBool::new(false);
static IS_ENABLED: AtomicBool = AtomicBool::new(false);
static IS_ENFORCING: AtomicBool = AtomicBool::new(false);
static LAST_REQUEST_MS: AtomicU64 = AtomicU64::new(0);
static PUBLIC_DECLARATIONS: Guarded<Vec<(Vec<u8>, u64, Vec<u8>)>> = Guarded::new(Vec::new());
static STARTS_IMMEDIATELY: AtomicBool = AtomicBool::new(false);
static HAS_BUILD_BLOCKING_ERROR: AtomicBool = AtomicBool::new(false);
#[cfg(unix)]
const STOPS: &[u8] = b"what stops a build\0";

fn log_verbose(text: &str) {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    if unsafe { libc::getenv(c"BUN_AOT_VERBOSE".as_ptr()) }.is_null() {
        return;
    }
    let line = format!("[aot] type check: {text}\n");
    bun_core::Output::flush();
    // SAFETY: `line` is readable for `line.len()` bytes.
    unsafe { libc::write(2, line.as_ptr().cast(), line.len() as _) };
}
static RENDERED_DIAGNOSTICS: Guarded<Vec<u8>> = Guarded::new(Vec::new());
static SKIPPED_TEST_FILES: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());

pub(crate) fn is_skipped_for_type_errors(entry_point: &[u8]) -> bool {
    SKIPPED_TEST_FILES.lock().iter().any(|path| path == entry_point)
}
static IS_WATCH_MODE: AtomicBool = AtomicBool::new(false);
static IS_STOPPED: AtomicBool = AtomicBool::new(false);
static SINGLE_FILE_ANALYSES_IN_FLIGHT: Guarded<std::collections::BTreeSet<Vec<u8>>> = Guarded::new(std::collections::BTreeSet::new());
static SINGLE_FILE_ANALYSIS_DONE: bun_threading::Condvar = bun_threading::Condvar::new();
#[cfg(unix)]
static CHILD: Guarded<i32> = Guarded::new(0);

const HELPER: &str = include_str!("aot_audit.js");
#[cfg(unix)]
const AUDIT_FD_ENV: &core::ffi::CStr = c"BUN_INTERNAL_AOT_AUDIT_FD";
#[cfg(unix)]
const AUDIT_PASS_FD_ENV: &core::ffi::CStr = c"BUN_INTERNAL_AOT_AUDIT_PASS_FD";

unsafe extern "C" {
    fn Bun__AOTAudit__install(
        global: *mut bun_jsc::JSGlobalObject,
        source: *const u8,
        length: usize,
        cwd: *const u8,
        cwd_len: usize,
    );
    fn Bun__AOTAudit__setPendingSites(
        source_len: usize,
        expressions: *const [u32; 6],
        expression_count: usize,
        parameters: *const [u32; 6],
        parameter_count: usize,
    );
    fn Bun__AOTAudit__setGeneration(generation: u32);
}

fn print_note(text: &str) {
    if is_enforcing() {
        return;
    }
    let line = format!("[aot] note: {text}\n");
    bun_core::Output::flush();
    // SAFETY: `line` is readable for `line.len()` bytes.
    unsafe { libc::write(2, line.as_ptr().cast(), line.len() as _) };
}

fn log() -> (i32, bool) {
    static LOG: std::sync::OnceLock<(i32, bool)> = std::sync::OnceLock::new();
    *LOG.get_or_init(|| {
        let said = |name: &core::ffi::CStr| {
            // SAFETY: getenv only reads, and `name` is NUL-terminated.
            let value = unsafe { libc::getenv(name.as_ptr()) };
            // SAFETY: not null, so a NUL-terminated string, which nothing changes while it is read
            // here.
            (!value.is_null()).then(|| unsafe { core::ffi::CStr::from_ptr(value) }).filter(|value| !value.is_empty())
        };
        let (descriptor, is_file) = match said(c"BUN_AOT_TYPE_ERROR_LOG") {
            None if IS_ENFORCING.load(Ordering::Acquire) => (-1, false),
            None => (2, false),
            Some(to) if to == c"stderr" => (2, false),
            Some(to) if to == c"off" => (-1, false),
            #[cfg(unix)]
            // SAFETY: `path` is NUL-terminated.
            Some(path) => match unsafe { libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_APPEND | libc::O_CREAT | libc::O_CLOEXEC, 0o644) } {
                -1 => (2, false),
                opened => (opened, true),
            },
            #[cfg(not(unix))]
            Some(_) => (2, false),
        };
        (descriptor, said(c"BUN_AOT_TYPE_ERROR_LOG_FORMAT").map_or(is_file, |format| format == c"json"))
    })
}

fn write_record(line: &[u8]) {
    let descriptor = if line.starts_with(b"[aot] note") { 2 } else { log().0 };
    if descriptor >= 0 {
        bun_core::Output::flush();
        // SAFETY: `line` is readable for `line.len()` bytes.
        unsafe { libc::write(descriptor, line.as_ptr().cast(), line.len() as _) };
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__write(line: *const u8, length: usize) {
    // SAFETY: `line[..length]` is the caller's live buffer.
    write_record(unsafe { core::slice::from_raw_parts(line, length) });
}

fn start_of_next_token(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at..) {
            Some([b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C, ..]) => at += 1,
            Some([0xC2, 0xA0, ..]) => at += 2,
            Some([0xE2, 0x80, 0xA8 | 0xA9, ..]) | Some([0xEF, 0xBB, 0xBF, ..]) => at += 3,
            Some([b'/', b'/', rest @ ..]) => {
                at += 2 + bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len());
            }
            Some([b'/', b'*', rest @ ..]) => match bun_core::strings::index_of(rest, b"*/") {
                Some(end) => at += 2 + end + 2,
                None => return text.len(),
            },
            _ => return at,
        }
    }
}

fn native_path(cwd: &[u8], shown: &[u8]) -> Vec<u8> {
    bun_paths::resolve_path::join_abs_string::<bun_paths::platform::Auto>(cwd, &[bun_sema_driver::host::to_native(shown)]).to_vec()
}

fn group_json(shown: &str, trust: Confidence, group: &bun_aot::audit::Group) -> Box<str> {
    let unsure = trust.text();
    format!("{{\"file\":{shown},{unsure}\"step\":{},\"steps\":[{}]}}", group.step, group.steps).into_boxed_str()
}

fn parameter_json(shown: &str, trust: Confidence, parameter: &bun_aot::audit::Parameter) -> Box<str> {
    let unsure = trust.text();
    format!("{{\"file\":{shown},{unsure}\"parameter\":true,\"steps\":[{}]}}", parameter.step).into_boxed_str()
}

impl State {
    fn add(&mut self, cwd: &[u8], module: &bun_aot::audit::Module, text: &[u8], trust: Confidence) -> &'static AuditedFile {
        self.awaits_whole_program_analysis |= trust != Confidence::Sure;
        let shown = bun_aot::audit::quoted_text(&module.path);
        let mut audited = AuditedFile {
            source_hash: hash_of(text),
            ..Default::default()
        };
        let (mut groups, mut parameters) = (HashMap::default(), HashMap::default());
        for group in &module.groups {
            let id = self.described.len() as u32;
            self.described.push(Described {
                passes: if group.step != 0 { 0 } else { group.passes },
                minimum: group.minimum,
                maximum: group.maximum,
                text: group_json(&shown, trust, group),
            });
            groups.insert((group.start, group.end, group.step), id);
            audited.expressions.push(AuditedExpression {
                next: start_of_next_token(text, group.end as usize) as u32,
                start: group.start,
                id,
            });
        }
        for parameter in &module.parameters {
            let id = self.described.len() as u32;
            self.described.push(Described {
                passes: parameter.passes,
                minimum: parameter.minimum,
                maximum: parameter.maximum,
                text: parameter_json(&shown, trust, parameter),
            });
            parameters.insert((parameter.function, parameter.index), id);
            audited.parameters.push(AuditedParameter {
                function: parameter.function,
                index: parameter.index,
                id,
            });
        }
        for validation in &module.validations {
            audited.validations.push(AuditedValidation {
                next: start_of_next_token(text, validation.end as usize) as u32,
                start: validation.start,
                which: validation.which,
                plan: validation.plan.clone().into_boxed_slice(),
            });
        }
        audited.sort();
        // SAFETY: just allocated. It is freed only by `merge`, and only if it is of a `State` that
        // nobody has read from yet.
        let audited: &'static AuditedFile = unsafe { &*bun_core::heap::alloc(audited) };
        bun_core::asan::ignore_object(core::ptr::from_ref(audited).cast());
        self.files.insert(native_path(cwd, &module.path), File { audited, groups, parameters });
        audited
    }

    fn add_without_sites(&mut self, path: &[u8], source_hash: u64) -> &'static AuditedFile {
        // SAFETY: as in `add`.
        let audited: &'static AuditedFile = unsafe {
            &*bun_core::heap::alloc(AuditedFile {
                source_hash,
                ..Default::default()
            })
        };
        bun_core::asan::ignore_object(core::ptr::from_ref(audited).cast());
        self.files.insert(path.to_vec(), File { audited, groups: HashMap::default(), parameters: HashMap::default() });
        audited
    }

    #[cfg(unix)]
    fn merge(&mut self, found: State) {
        let State { files, described, shapes, code, .. } = found;
        for path in code {
            if !self.code.contains(&path) {
                self.code.push(path);
            }
        }
        for (path, theirs) in files {
            let ours = self.files.get(&path);
            if ours.is_some_and(|ours| ours.audited.source_hash == theirs.audited.source_hash) {
                let ours = ours.expect("it was asked");
                let mut texts: HashMap<u32, &str> = ours.groups.values().chain(ours.parameters.values()).map(|&id| (id, "{\"steps\":[]}")).collect();
                for (key, &id) in &theirs.groups {
                    if let Some(&mine) = ours.groups.get(key) {
                        texts.insert(mine, &described[id as usize].text);
                    }
                }
                for (key, &id) in &theirs.parameters {
                    if let Some(&mine) = ours.parameters.get(key) {
                        texts.insert(mine, &described[id as usize].text);
                    }
                }
                for (id, text) in texts {
                    self.described[id as usize].text = Box::from(text);
                }
            } else if ours.is_none() {
                let first = self.described.len() as u32;
                let mut ids: Vec<u32> = theirs.groups.values().chain(theirs.parameters.values()).copied().collect();
                ids.sort_unstable();
                let renumbered = |id: u32| first + ids.binary_search(&id).unwrap_or(0) as u32;
                for &id in &ids {
                    let it = &described[id as usize];
                    self.described.push(Described { passes: it.passes, minimum: it.minimum, maximum: it.maximum, text: it.text.clone() });
                }
                let mut audited = AuditedFile {
                    source_hash: theirs.audited.source_hash,
                    ..Default::default()
                };
                audited.expressions.extend(theirs.audited.expressions.iter().map(|it| AuditedExpression { next: it.next, start: it.start, id: renumbered(it.id) }));
                audited.parameters.extend(theirs.audited.parameters.iter().map(|it| AuditedParameter { function: it.function, index: it.index, id: renumbered(it.id) }));
                audited.validations.extend(theirs.audited.validations.iter().cloned());
                audited.sort();
                // SAFETY: as in `add`.
                let audited: &'static AuditedFile = unsafe { &*bun_core::heap::alloc(audited) };
                let groups = theirs.groups.iter().map(|(&key, &id)| (key, renumbered(id))).collect();
                let parameters = theirs.parameters.iter().map(|(&key, &id)| (key, renumbered(id))).collect();
                self.files.insert(path, File { audited, groups, parameters });
            }
            // SAFETY: `found` came out of `State::from_bytes`, which allocated it with
            // `heap::alloc`, and was handed to nobody else. `theirs` is not used again.
            drop(unsafe { bun_core::heap::take(core::ptr::from_ref(theirs.audited).cast_mut()) });
        }
        self.shapes = shapes;
        self.bump_generation();
    }

    fn bump_generation(&mut self) {
        self.generation += 1;
        // SAFETY: it stores the number.
        unsafe { Bun__AOTAudit__setGeneration(self.generation) };
    }

    fn refine(&mut self, cwd: &[u8], module: &bun_aot::audit::Module, text: &[u8]) {
        let Some(file) = self.files.get(&native_path(cwd, &module.path)) else {
            self.add(cwd, module, text, Confidence::Sure);
            return;
        };
        if file.audited.source_hash != hash_of(text) {
            return;
        }
        let shown = bun_aot::audit::quoted_text(&module.path);
        let mut texts: HashMap<u32, Box<str>> = HashMap::default();
        for &id in file.groups.values().chain(file.parameters.values()) {
            texts.insert(id, Box::from("{\"steps\":[]}"));
        }
        for group in &module.groups {
            if let Some(&id) = file.groups.get(&(group.start, group.end, group.step)) {
                texts.insert(id, group_json(&shown, Confidence::Sure, group));
            }
        }
        for parameter in &module.parameters {
            if let Some(&id) = file.parameters.get(&(parameter.function, parameter.index)) {
                texts.insert(id, parameter_json(&shown, Confidence::Sure, parameter));
            }
        }
        for (id, text) in texts {
            self.described[id as usize].text = text;
        }
    }
}

fn run_on_new_thread<T: Send>(run: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        let thread = std::thread::Builder::new().stack_size(64 << 20).spawn_scoped(scope, move || {
            bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
            let found = run();
            bun_core::Output::flush();
            found
        });
        match thread.expect("a thread for the audit").join() {
            Ok(found) => found,
            Err(panic) => std::panic::resume_unwind(panic),
        }
    })
}

fn analyze_whole_program(entry_points: &[Vec<u8>], code: &[Vec<u8>], hinted: &[Vec<u8>], is_for_tests: bool, before_read: Option<bun_sema_driver::host::BeforeRead>, audited: Audited<'_>) -> bool {
    let cwd = crate::cli::check_command::working_directory();
    let mut refused_entry_points: Vec<Vec<u8>> = Vec::new();
    let (mut code, mut before_read) = (code.to_vec(), before_read);
    let (given, mut taken_out) = (code.len(), Vec::new());
    code.extend_from_slice(hinted);
    let found = loop {
        let entries: Vec<EntryPoint> = entry_points.iter().map(|path| EntryPoint::file(path)).collect();
        let more_code = MoreCode { paths: &code, fixed: given, taken_out: &taken_out, refused_entry_points: &refused_entry_points };
        let mut found = audit_before(&entries, before_read.take(), is_for_tests, audited, more_code, None).unwrap_or_default();
        if !found.unlinked_files.is_empty() || !found.never_visited.is_empty() {
            code.retain(|path| !found.unlinked_files.contains(path));
            taken_out.append(&mut found.unlinked_files);
            code.append(&mut found.never_visited);
            continue;
        }
        if found.entry_points_reaching_errors.is_empty() || found.entry_points_reaching_errors.len() + refused_entry_points.len() == entry_points.len() || !matches!(audited, Audited::Whole) || !IS_ENFORCING.load(Ordering::Acquire) || IS_WATCH_MODE.load(Ordering::Acquire) {
            break found;
        }
        refused_entry_points.extend_from_slice(&found.entry_points_reaching_errors);
        SKIPPED_TEST_FILES.lock().append(&mut found.entry_points_reaching_errors);
    };
    if found.has_build_blocking_error && matches!(audited, Audited::Whole) && IS_ENFORCING.load(Ordering::Acquire) {
        bun_core::Output::flush();
        if !IS_WATCH_MODE.load(Ordering::Acquire) {
            bun_core::Global::exit(1);
        }
        IS_STOPPED.store(true, Ordering::Release);
    }
    let mut state = STATE.lock();
    let state = state.get_or_insert_with(State::default);
    state.entry_points.retain(|path| !is_skipped_for_type_errors(path));
    for path in code {
        if !state.code.contains(&path) {
            state.code.push(path);
        }
    }
    for (module, text) in &found.modules {
        state.refine(&cwd, module, text);
    }
    state.shapes = found.shapes.into_iter().map(|(key, text)| (key, text.into_boxed_str())).collect();
    state.bump_generation();
    *RENDERED_DIAGNOSTICS.lock() = found.said;
    HAS_BUILD_BLOCKING_ERROR.store(found.has_build_blocking_error, Ordering::Release);
    *PUBLIC_DECLARATIONS.lock() = found.public_declarations;
    !found.has_build_blocking_error && !found.has_errors && SKIPPED_TEST_FILES.lock().is_empty()
}

#[cfg(unix)]
mod retained {
    use bun_sema_driver::fs_queries::{Kind, FsQuery};
    use std::sync::atomic::{AtomicBool, Ordering};

    const MAGIC: &[u8; 8] = b"bunlook4";

    const MAX_CACHE_BYTES: u64 = 1 << 30;
    static IS_WRITING: AtomicBool = AtomicBool::new(false);

    pub(super) struct Taken {
        pub(super) read: Vec<Vec<u8>>,
        pub(super) said: Vec<u8>,
        pub(super) tables: Vec<u8>,
        pub(super) changed: Vec<Vec<u8>>,
        pub(super) holds: bool,
        pub(super) public_declarations: Vec<(Vec<u8>, u64, Vec<u8>)>,
    }

    pub(super) fn hash(bytes: &[u8]) -> u64 {
        bun_wyhash::hash(bytes)
    }

    fn folder() -> Option<Vec<u8>> {
        use bun_core::env_var;
        let inside = |parts: &[&[u8]]| Some(parts.join(&b"/"[..])).filter(|path| path.starts_with(b"/"));
        if let Some(folder) = env_var::BUN_RUNTIME_TRANSPILER_CACHE_PATH.get() {
            return if folder.is_empty() || folder == b"0" { None } else { inside(&[folder, b"@aot@"]) };
        }
        if let Some(folder) = env_var::XDG_CACHE_HOME.get() {
            return inside(&[folder, b"bun", b"@aot@"]);
        }
        let home = env_var::HOME.get()?;
        if cfg!(target_os = "macos") { inside(&[home, b"Library/Caches/bun", b"@aot@"]) } else { inside(&[home, b".bun/install/cache", b"@aot@"]) }
    }

    pub(super) struct Start {
        key: Vec<u8>,
        path: Vec<u8>,
        settings: Vec<Vec<u8>>,
    }

    impl Start {
        pub(super) fn new(entry_points: &[Vec<u8>], is_for_tests: bool, is_enforcing: bool) -> Option<Start> {
            let folder = folder()?;
            let executable = bun_core::self_exe_path().ok()?;
            // SAFETY: `stat` is plain data for which all zeros is a valid value.
            let mut found: libc::stat = unsafe { bun_core::ffi::zeroed_unchecked() };
            // SAFETY: the path is NUL-terminated and `found` is a valid out-param.
            if unsafe { libc::stat(executable.as_ptr().cast(), &mut found) } != 0 {
                return None;
            }
            let cwd = crate::cli::check_command::working_directory();
            bun_sema_driver::fs_queries::set_working_directory(&bun_sema_driver::host::from_native(&cwd));
            let form = crate::cli::check_command::diagnostic_format_key();
            let mut key = format!("{} {} {} {} {is_for_tests} {is_enforcing} {form:?}\0", bun_core::Global::package_json_version_with_sha, found.st_size, found.st_mtime, found.st_mtime_nsec).into_bytes();
            for part in [executable.as_bytes(), &cwd[..]] {
                key.extend_from_slice(part);
                key.push(0);
            }
            let is_entry_name = |argument: &[u8]| {
                let written = argument.strip_prefix(b"./").unwrap_or(argument);
                !argument.starts_with(b"-") && !written.is_empty() && entry_points.iter().any(|path| path.ends_with(written))
            };
            for argument in bun_core::argv().into_iter().skip(1).filter(|it| !matches!(*it, b"--watch" | b"--hot")) {
                key.extend_from_slice(argument);
                key.push(0);
                if is_entry_name(argument) {
                    break;
                }
            }
            for path in entry_points {
                key.extend_from_slice(path);
                key.push(0);
            }
            let path = [&folder[..], format!("/{:02x}.look", hash(&key) & 63).as_bytes()].concat();
            let mut settings = vec![[&cwd[..], b"/bunfig.toml"].concat()];
            for home in [bun_core::env_var::HOME.get(), bun_core::env_var::XDG_CONFIG_HOME.get()].into_iter().flatten() {
                settings.push([home, b"/.bunfig.toml"].concat());
            }
            Some(Start { key, path, settings })
        }

        pub(super) fn take(&self) -> Option<Taken> {
            let file = bun_sys::File::read_from(bun_sys::Fd::cwd(), &self.path).ok()?;
            let rest = file.strip_prefix(MAGIC)?;
            let (checksum, mut rest) = rest.split_first_chunk::<8>()?;
            if u64::from_le_bytes(*checksum) != hash(rest) {
                return None;
            }
            let number = |rest: &mut &[u8]| -> Option<u64> {
                let (value, after) = rest.split_first_chunk::<8>()?;
                *rest = after;
                Some(u64::from_le_bytes(*value))
            };
            let bytes = |rest: &mut &[u8]| -> Option<Vec<u8>> {
                let length = usize::try_from(number(rest)?).ok()?;
                let (value, after) = rest.split_at_checked(length)?;
                *rest = after;
                Some(value.to_vec())
            };
            if bytes(&mut rest)? != self.key {
                return None;
            }
            let count = usize::try_from(number(&mut rest)?).ok()?;
            let mut queries = Vec::new();
            for _ in 0..count {
                let (kind, answer) = (Kind::from_number(number(&mut rest)?)?, number(&mut rest)?);
                queries.push(FsQuery { kind, path: bytes(&mut rest)?, answer });
            }
            let count = usize::try_from(number(&mut rest)?).ok()?;
            let mut public_declarations = Vec::new();
            for _ in 0..count {
                let seen = number(&mut rest)?;
                let path = bytes(&mut rest)?;
                public_declarations.push((path, seen, bytes(&mut rest)?));
            }
            let said = bytes(&mut rest)?;
            let threads = usize::from(bun_core::get_thread_count()).min(16);
            let mut holds = true;
            let mut changed = Vec::new();
            for at in bun_sema_driver::fs_queries::changed_answers(&queries, hash, threads) {
                let path = bun_sema_driver::host::to_native(&queries[at].path).to_vec();
                holds &= queries[at].kind == Kind::Text && public_declarations.iter().any(|it| it.0 == path);
                changed.push(path);
            }
            let read = queries.into_iter().filter(|query| query.kind == Kind::Text).map(|query| query.path).collect();
            Some(Taken { read, said, tables: rest.to_vec(), changed, public_declarations, holds })
        }

        pub(super) fn record_settings(&self) {
            for path in &self.settings {
                let text = bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok();
                bun_sema_driver::fs_queries::record_query(Kind::NativeText, path, |hash| bun_sema_driver::fs_queries::of_text(hash, text.as_deref()));
            }
        }

        fn ticket_path(&self) -> Vec<u8> {
            [self.path.strip_suffix(b".look").unwrap_or(&self.path), b".ticket"].concat()
        }

        pub(super) fn write_ticket(&self) {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |it| it.as_nanos());
            let Ok(path) = std::ffi::CString::new(self.ticket_path()) else { return };
            let ticket = format!("{} {now}", std::process::id());
            // SAFETY: the path is NUL-terminated.
            let fd = unsafe { libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC, 0o600) };
            if fd >= 0 {
                // SAFETY: `ticket` is readable for its length; `fd` is ours and is not used again.
                unsafe {
                    libc::write(fd, ticket.as_ptr().cast(), ticket.len());
                    libc::close(fd);
                }
            }
        }

        pub(super) fn exit_when_superseded(&self) {
            let path = self.ticket_path();
            let read = move || bun_sys::File::read_from(bun_sys::Fd::cwd(), &path).ok();
            let mine = read();
            let _ = std::thread::Builder::new().spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    if read() != mine && !IS_WRITING.load(Ordering::Acquire) {
                        // SAFETY: _exit(2) has no preconditions.
                        unsafe { libc::_exit(0) };
                    }
                }
            });
        }

        pub(super) fn forget(&self) {
            if let Ok(path) = std::ffi::CString::new(&self.path[..]) {
                // SAFETY: the path is NUL-terminated.
                unsafe { libc::unlink(path.as_ptr()) };
            }
        }

        pub(super) fn put(&self, queries: &[FsQuery], public_declarations: &[(Vec<u8>, u64, Vec<u8>)], said: &[u8], tables: &[u8]) {
            let mut rest = Vec::with_capacity(tables.len() + queries.len() * 96);
            let bytes = |rest: &mut Vec<u8>, value: &[u8]| {
                rest.extend_from_slice(&(value.len() as u64).to_le_bytes());
                rest.extend_from_slice(value);
            };
            bytes(&mut rest, &self.key);
            rest.extend_from_slice(&(queries.len() as u64).to_le_bytes());
            for query in queries {
                rest.extend_from_slice(&(query.kind as u64).to_le_bytes());
                rest.extend_from_slice(&query.answer.to_le_bytes());
                bytes(&mut rest, &query.path);
            }
            rest.extend_from_slice(&(public_declarations.len() as u64).to_le_bytes());
            for (path, seen, declarations) in public_declarations {
                rest.extend_from_slice(&seen.to_le_bytes());
                bytes(&mut rest, path);
                bytes(&mut rest, declarations);
            }
            bytes(&mut rest, said);
            rest.extend_from_slice(tables);
            let head = [&MAGIC[..], &hash(&rest).to_le_bytes()].concat();
            for (at, _) in self.path.iter().enumerate().filter(|&(at, &byte)| at > 0 && byte == b'/') {
                let Ok(folder) = std::ffi::CString::new(&self.path[..at]) else { return };
                // SAFETY: the path is NUL-terminated.
                unsafe { libc::mkdir(folder.as_ptr(), 0o700) };
            }
            let Ok(path) = std::ffi::CString::new(&self.path[..]) else { return };
            let mut temporary = [&self.path[..], b".XXXXXX\0"].concat();
            // SAFETY: `temporary` is writable and ends with "XXXXXX" and a NUL.
            let fd = unsafe { libc::mkstemp(temporary.as_mut_ptr().cast()) };
            if fd < 0 {
                return;
            }
            IS_WRITING.store(true, Ordering::Release);
            let mut is_written = true;
            for part in [&head[..], &rest[..]] {
                let mut at = 0;
                while is_written && at < part.len() {
                    // SAFETY: the rest of `part` is readable for that many bytes.
                    let written = unsafe { libc::write(fd, part[at..].as_ptr().cast(), part.len() - at) };
                    is_written = written > 0;
                    at += written.max(0) as usize;
                }
            }
            // SAFETY: `fd` is ours and is not used again; both paths are NUL-terminated.
            unsafe {
                libc::close(fd);
                if !is_written || libc::rename(temporary.as_ptr().cast(), path.as_ptr()) != 0 {
                    libc::unlink(temporary.as_ptr().cast());
                }
            }
            IS_WRITING.store(false, Ordering::Release);
            self.evict_old_entries();
        }

        fn evict_old_entries(&self) {
            let Some(slash) = bun_core::strings::last_index_of_char(&self.path, b'/') else { return };
            let Ok(folder) = std::ffi::CString::new(&self.path[..slash]) else { return };
            // SAFETY: the path is NUL-terminated.
            let directory = unsafe { libc::opendir(folder.as_ptr()) };
            if directory.is_null() {
                return;
            }
            // SAFETY: time(2) takes a null pointer.
            let now = unsafe { libc::time(core::ptr::null_mut()) };
            let mut retained = Vec::new();
            loop {
                // SAFETY: `directory` is open. The entry is read before the next call.
                let entry = unsafe { libc::readdir(directory) };
                if entry.is_null() {
                    break;
                }
                // SAFETY: `d_name` is NUL-terminated.
                let name = unsafe { core::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
                let is_kept = name.ends_with(b".look");
                if !is_kept && !bun_core::strings::contains(name, b".look.") {
                    continue;
                }
                let Ok(path) = std::ffi::CString::new([&self.path[..=slash], name].concat()) else { continue };
                // SAFETY: `stat` is plain data for which all zeros is a valid value.
                let mut found: libc::stat = unsafe { bun_core::ffi::zeroed_unchecked() };
                // SAFETY: the path is NUL-terminated and `found` is a valid out-param.
                if unsafe { libc::stat(path.as_ptr(), &mut found) } != 0 {
                    continue;
                }
                if is_kept {
                    retained.push(((found.st_mtime, found.st_mtime_nsec), found.st_size.max(0) as u64, path));
                } else if now - found.st_mtime > 600 {
                    // SAFETY: the path is NUL-terminated.
                    unsafe { libc::unlink(path.as_ptr()) };
                }
            }
            // SAFETY: `directory` is open and is not used again.
            unsafe { libc::closedir(directory) };
            retained.sort();
            let mut all: u64 = retained.iter().map(|it| it.1).sum();
            for (_, size, path) in retained {
                if all <= MAX_CACHE_BYTES {
                    break;
                }
                if path.as_bytes() != &self.path[..] {
                    // SAFETY: the path is NUL-terminated.
                    unsafe { libc::unlink(path.as_ptr()) };
                    all -= size;
                }
            }
        }
    }
}

#[cfg(unix)]
fn analyze_whole_program_in_child(entry_points: &[Vec<u8>], code: &[Vec<u8>]) -> Option<State> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::process::CommandExt;
    let asked: Vec<Vec<u8>> = (entry_points.iter().map(|it| [&b"E"[..], &it[..]].concat())).chain(code.iter().map(|it| [&b"C"[..], &it[..]].concat())).collect();
    let fd = anonymous_file_with(&asked.join(&0u8))?;
    let found = (|| {
        let executable = bun_core::self_exe_path().ok()?;
        #[allow(clippy::disallowed_types)]
        let mut command = std::process::Command::new(std::ffi::OsStr::from_bytes(executable.as_bytes()));
        for argument in bun_core::argv().into_iter().skip(1).filter(|it| !matches!(*it, b"--watch" | b"--hot")) {
            command.arg(std::ffi::OsStr::from_bytes(argument));
        }
        command.env(std::ffi::OsStr::from_bytes(AUDIT_PASS_FD_ENV.to_bytes()), fd.to_string());
        command.env_remove(std::ffi::OsStr::from_bytes(AUDIT_FD_ENV.to_bytes()));
        command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        // SAFETY: between fork and exec the closure only calls nice(2), which is async-signal-safe.
        unsafe {
            command.pre_exec(|| {
                libc::nice(10);
                Ok(())
            })
        };
        let mut child = command.spawn().ok()?;
        *CHILD.lock() = child.id() as i32;
        // SAFETY: `siginfo_t` is plain data for which all zeros is a valid value.
        let mut ended: libc::siginfo_t = unsafe { bun_core::ffi::zeroed_unchecked() };
        // SAFETY: `ended` is a valid out-param.
        while unsafe { libc::waitid(libc::P_PID, child.id() as libc::id_t, &mut ended, libc::WEXITED | libc::WNOWAIT) } == -1 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {}
        {
            let mut running = CHILD.lock();
            *running = 0;
            let _ = child.wait();
        }
        let bytes = read_fd_to_end(fd)?;
        if let Some(said) = bytes.strip_prefix(STOPS) {
            if is_enforcing() {
                let _ = bun_core::Output::error_writer().write_all(said);
                bun_core::Output::flush();
                if !IS_WATCH_MODE.load(Ordering::Acquire) {
                    bun_core::Global::exit(1);
                }
            }
            return None;
        }
        State::from_bytes(&bytes)
    })();
    // SAFETY: `fd` is ours, from `anonymous_file_with`, and is not used again.
    unsafe { libc::close(fd) };
    found
}

#[cfg(unix)]
fn kill_child() {
    let mut running = CHILD.lock();
    if *running > 0 {
        // SAFETY: kill(2) takes no pointers. `CHILD` holds the id only while the child has not been
        // waited for, so it names no other process.
        unsafe { libc::kill(*running, libc::SIGKILL) };
    }
    *running = 0;
}

#[cfg(not(unix))]
fn kill_child() {}

fn analyze_whole_program_in_background() {
    kill_child();
    if IS_ANALYZING_WHOLE_PROGRAM.swap(true, Ordering::AcqRel) {
        return;
    }
    let still_waits = || STATE.lock().as_ref().is_some_and(|state| state.awaits_whole_program_analysis);
    let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        while still_waits() {
            while !STARTS_IMMEDIATELY.load(Ordering::Acquire) && milliseconds().saturating_sub(LAST_REQUEST_MS.load(Ordering::Acquire)) < 300 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let Some((entry_points, code, is_for_tests)) = STATE.lock().as_mut().map(|state| {
                state.awaits_whole_program_analysis = false;
                (state.entry_points.clone(), state.code.clone(), state.is_for_tests)
            }) else {
                break;
            };
            #[cfg(unix)]
            {
                let _ = is_for_tests;
                let found = analyze_whole_program_in_child(&entry_points, &code);
                if let (Some(found), Some(state)) = (found, STATE.lock().as_mut()) {
                    state.merge(found);
                }
            }
            #[cfg(not(unix))]
            analyze_whole_program(&entry_points, &code, &[], is_for_tests, None, Audited::WholeProgramInBackground);
        }
        bun_core::Output::flush();
        IS_ANALYZING_WHOLE_PROGRAM.store(false, Ordering::Release);
        if still_waits() {
            analyze_whole_program_in_background();
        }
    });
    if thread.is_err() {
        IS_ANALYZING_WHOLE_PROGRAM.store(false, Ordering::Release);
    }
}

fn hash_of(text: &[u8]) -> u64 {
    bun_wyhash::hash(bun_core::strings::without_utf8_bom(text))
}

fn milliseconds() -> u64 {
    static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START_TIME.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

fn known(path: &[u8], hash: u64) -> Option<Option<&'static AuditedFile>> {
    let state = STATE.lock();
    let Some(state) = state.as_ref() else { return Some(None) };
    match state.files.get(path) {
        Some(file) if file.audited.source_hash == hash => Some(Some(file.audited)),
        Some(_) => None,
        None if !State::may_have_audit_table(path) => Some(None),
        None => None,
    }
}

fn analyze_single_file(path: &[u8], text: &[u8]) -> Option<&'static AuditedFile> {
    let hash = hash_of(text);
    let mut looked_at = SINGLE_FILE_ANALYSES_IN_FLIGHT.lock();
    loop {
        if let Some(found) = known(path, hash) {
            return found;
        }
        if looked_at.insert(path.to_vec()) {
            let (its_path, its_text) = (path.to_vec(), text.to_vec());
            let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
                analyze_single_file_now(&its_path, &its_text, hash);
                bun_core::Output::flush();
            });
            if thread.is_err() {
                looked_at.remove(path);
                return None;
            }
        }
        SINGLE_FILE_ANALYSIS_DONE.wait_guarded(&mut looked_at);
    }
}

fn analyze_single_file_now(path: &[u8], text: &[u8], hash: u64) {
    kill_child();
    let (mut entry_points, is_for_tests, is_known_to_the_whole) = {
        let state = STATE.lock();
        state.as_ref().map_or_else(Default::default, |state| (state.entry_points.clone(), state.is_for_tests, state.files.contains_key(path)))
    };
    static UNKNOWN_FILE_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let is_looked_at = is_known_to_the_whole || UNKNOWN_FILE_COUNT.fetch_add(1, Ordering::AcqRel) < 8;
    if !is_known_to_the_whole {
        entry_points.push(path.to_vec());
    }
    let is_of_a_package = bun_core::strings::contains(path, b"node_modules");
    let cwd = crate::cli::check_command::working_directory();
    let is_told = AtomicBool::new(false);
    let tell = |found: crate::cli::check_command::AuditFound| {
        if is_told.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Some(state) = STATE.lock().as_mut() {
            let mut is_added = false;
            let falls = !is_known_to_the_whole && found.has_errors;
            for (module, text) in found.modules.iter().filter(|(module, _)| !falls && native_path(&cwd, &module.path) == path) {
                let trust = if is_known_to_the_whole || !is_of_a_package { Confidence::Unsure } else { Confidence::Silent };
                is_added = state.add(&cwd, module, text, trust).source_hash == hash;
                if !is_added {
                    print_note(&format!("{} is not audited: the analysis read a different text of this file than the one that runs (a direct eval(), a loader plugin, or an edit while it loaded)", bstr::BStr::new(&module.path)));
                }
            }
            if !is_added {
                state.add_without_sites(path, hash);
            }
            if !is_known_to_the_whole && !state.code.iter().any(|known| known == path) {
                state.code.push(path.to_vec());
                state.awaits_whole_program_analysis = true;
            }
        }
        SINGLE_FILE_ANALYSES_IN_FLIGHT.lock().remove(path);
        SINGLE_FILE_ANALYSIS_DONE.notify_all();
    };
    let entries: Vec<EntryPoint> = entry_points.iter().map(|path| EntryPoint::file(path)).collect();
    struct NotifyOnDrop<'a>(&'a (dyn Fn(crate::cli::check_command::AuditFound) + Sync));
    impl Drop for NotifyOnDrop<'_> {
        fn drop(&mut self) {
            (self.0)(Default::default());
        }
    }
    let at_last = NotifyOnDrop(&tell);
    if is_looked_at {
        let _ = audit_before(&entries, None, is_for_tests, Audited::Alone { path, text, is_quiet: !is_known_to_the_whole }, MoreCode::default(), Some(&tell));
    }
    drop(at_last);
    analyze_whole_program_in_background();
}

fn table_for(path: &[u8], text: &[u8]) -> Option<&'static AuditedFile> {
    LAST_REQUEST_MS.store(milliseconds(), Ordering::Release);
    match known(path, hash_of(text)) {
        Some(found) => found,
        None if is_enforcing() => None,
        None => analyze_single_file(path, text),
    }
}

fn reanalyze_changed_files() {
    let files: Vec<(Vec<u8>, u64)> = {
        let state = STATE.lock();
        state.as_ref().map_or_else(Vec::new, |state| state.files.iter().map(|(path, file)| (path.clone(), file.audited.source_hash)).collect())
    };
    let _ = std::thread::Builder::new().spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        for (path, hash) in files {
            if let Ok(text) = bun_sys::File::read_from(bun_sys::Fd::cwd(), &path)
                && hash_of(&text) != hash
            {
                analyze_single_file(&path, &text);
            }
        }
        bun_core::Output::flush();
    });
}

impl State {
    fn may_have_audit_table(path: &[u8]) -> bool {
        matches!(bun_paths::extension(path), b".ts" | b".tsx" | b".mts" | b".cts")
    }

    #[cfg(unix)]
    fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let number = |out: &mut Vec<u8>, value: u64| out.extend_from_slice(&value.to_le_bytes());
        let bytes = |out: &mut Vec<u8>, value: &[u8]| {
            out.extend_from_slice(&(value.len() as u64).to_le_bytes());
            out.extend_from_slice(value);
        };
        number(&mut out, self.described.len() as u64);
        for described in &self.described {
            number(&mut out, u64::from(described.passes));
            number(&mut out, u64::from(described.minimum as u32) << 32 | u64::from(described.maximum as u32));
            bytes(&mut out, described.text.as_bytes());
        }
        number(&mut out, u64::from(self.awaits_whole_program_analysis || IS_ANALYZING_WHOLE_PROGRAM.load(Ordering::Acquire)));
        number(&mut out, self.code.len() as u64);
        for path in &self.code {
            bytes(&mut out, path);
        }
        number(&mut out, self.shapes.len() as u64);
        for (key, text) in &self.shapes {
            bytes(&mut out, key.as_bytes());
            bytes(&mut out, text.as_bytes());
        }
        number(&mut out, self.files.len() as u64);
        for (path, file) in &self.files {
            bytes(&mut out, path);
            number(&mut out, file.audited.source_hash);
            number(&mut out, file.audited.expressions.len() as u64);
            for it in &file.audited.expressions {
                number(&mut out, u64::from(it.next) << 32 | u64::from(it.start));
                number(&mut out, u64::from(it.id));
            }
            number(&mut out, file.groups.len() as u64);
            for (&(start, end, step), &id) in &file.groups {
                number(&mut out, u64::from(start) << 32 | u64::from(end));
                number(&mut out, u64::from(step as u32) << 32 | u64::from(id));
            }
            number(&mut out, file.parameters.len() as u64);
            for (&(function, index), &id) in &file.parameters {
                number(&mut out, u64::from(function) << 32 | u64::from(index));
                number(&mut out, u64::from(id));
            }
            number(&mut out, file.audited.validations.len() as u64);
            for it in &file.audited.validations {
                number(&mut out, u64::from(it.next) << 32 | u64::from(it.start));
                number(&mut out, u64::from(it.which));
                bytes(&mut out, &it.plan);
            }
        }
        out
    }

    #[cfg(unix)]
    fn from_bytes(mut input: &[u8]) -> Option<State> {
        fn number(input: &mut &[u8]) -> Option<u64> {
            let (value, rest) = input.split_first_chunk::<8>()?;
            *input = rest;
            Some(u64::from_le_bytes(*value))
        }
        fn bytes<'a>(input: &mut &'a [u8]) -> Option<&'a [u8]> {
            let length = usize::try_from(number(input)?).ok()?;
            let (value, rest) = input.split_at_checked(length)?;
            *input = rest;
            Some(value)
        }
        let input = &mut input;
        let mut state = State::default();
        for _ in 0..number(input)? {
            let passes = number(input)? as u32;
            let range = number(input)?;
            let text = core::str::from_utf8(bytes(input)?).ok()?;
            state.described.push(Described { passes, minimum: (range >> 32) as u32 as i32, maximum: range as u32 as i32, text: Box::from(text) });
        }
        state.awaits_whole_program_analysis = number(input)? != 0;
        for _ in 0..number(input)? {
            state.code.push(bytes(input)?.to_vec());
        }
        for _ in 0..number(input)? {
            let key = core::str::from_utf8(bytes(input)?).ok()?.to_owned();
            let text = core::str::from_utf8(bytes(input)?).ok()?;
            state.shapes.insert(key, Box::from(text));
        }
        state.generation = 1;
        for _ in 0..number(input)? {
            let path = bytes(input)?.to_vec();
            let mut audited = AuditedFile {
                source_hash: number(input)?,
                ..Default::default()
            };
            for _ in 0..number(input)? {
                let (place, id) = (number(input)?, number(input)?);
                audited.expressions.push(AuditedExpression {
                    next: (place >> 32) as u32,
                    start: place as u32,
                    id: id as u32,
                });
            }
            let (mut groups, mut parameters) = (HashMap::default(), HashMap::default());
            for _ in 0..number(input)? {
                let (span, rest) = (number(input)?, number(input)?);
                groups.insert(((span >> 32) as u32, span as u32, (rest >> 32) as u32 as i32), rest as u32);
            }
            for _ in 0..number(input)? {
                let (place, id) = (number(input)?, number(input)?);
                parameters.insert(((place >> 32) as u32, place as u32), id as u32);
                audited.parameters.push(AuditedParameter {
                    function: (place >> 32) as u32,
                    index: place as u32,
                    id: id as u32,
                });
            }
            for _ in 0..number(input)? {
                let (place, which) = (number(input)?, number(input)?);
                audited.validations.push(AuditedValidation {
                    next: (place >> 32) as u32,
                    start: place as u32,
                    which: which as u8,
                    plan: Box::from(bytes(input)?),
                });
            }
            audited.sort();
            // SAFETY: as in `add`.
            let audited: &'static AuditedFile = unsafe { &*bun_core::heap::alloc(audited) };
            bun_core::asan::ignore_object(core::ptr::from_ref(audited).cast());
            state.files.insert(path, File { audited, groups, parameters });
        }
        Some(state)
    }
}

#[cfg(unix)]
fn anonymous_file_with(bytes: &[u8]) -> Option<i32> {
    let mut name = bun_bundler::bun_fs::RealFS::tmpdir_path().to_vec();
    name.extend_from_slice(b"/bun-aot-audit-XXXXXX\0");
    // SAFETY: `name` is writable and ends with "XXXXXX" and a NUL.
    let fd = unsafe { libc::mkstemp(name.as_mut_ptr().cast()) };
    if fd < 0 {
        return None;
    }
    // SAFETY: `name` is still NUL-terminated: mkstemp replaces the six letters only.
    unsafe { libc::unlink(name.as_ptr().cast()) };
    let mut at = 0;
    while at < bytes.len() {
        // SAFETY: the rest of `bytes` is readable for that many bytes.
        let written = unsafe { libc::write(fd, bytes[at..].as_ptr().cast(), bytes.len() - at) };
        if written <= 0 {
            // SAFETY: `fd` is ours and is not used again.
            unsafe { libc::close(fd) };
            return None;
        }
        at += written as usize;
    }
    Some(fd)
}

#[cfg(unix)]
fn pass_state_to_child() {
    kill_child();
    let state = STATE.lock();
    let Some(state) = state.as_ref() else { return };
    let Some(fd) = anonymous_file_with(&state.to_bytes()) else { return };
    bun_core::keep_open_across_reload(fd);
    let number = std::ffi::CString::new(fd.to_string()).expect("digits");
    // SAFETY: both strings are NUL-terminated; setenv copies them into libc env storage.
    unsafe { libc::setenv(AUDIT_FD_ENV.as_ptr(), number.as_ptr(), 1) };
}

#[cfg(unix)]
fn take_inherited_state() -> Option<State> {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    let number = unsafe { libc::getenv(AUDIT_FD_ENV.as_ptr()) };
    if number.is_null() {
        return None;
    }
    // SAFETY: not null, so a NUL-terminated string. It is read before the variable is unset below.
    let fd: i32 = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok()?.parse().ok()?;
    // SAFETY: the name is NUL-terminated.
    unsafe { libc::unsetenv(AUDIT_FD_ENV.as_ptr()) };
    let bytes = read_fd_to_end(fd);
    // SAFETY: `fd` was retained open over the reload for this read and is not used again.
    unsafe { libc::close(fd) };
    State::from_bytes(&bytes?)
}

#[cfg(unix)]
fn read_fd_to_end(fd: i32) -> Option<Vec<u8>> {
    // SAFETY: lseek(2) takes no pointers.
    let length = unsafe { libc::lseek(fd, 0, libc::SEEK_END) };
    let mut bytes = vec![0u8; usize::try_from(length).unwrap_or(0)];
    let mut at = 0;
    while at < bytes.len() {
        // SAFETY: the rest of `bytes` is writable for that many bytes.
        let read = unsafe { libc::pread(fd, bytes[at..].as_mut_ptr().cast(), bytes.len() - at, at as libc::off_t) };
        if read <= 0 {
            return None;
        }
        at += read as usize;
    }
    Some(bytes)
}

#[cfg(unix)]
fn analyze_for_parent_process(is_for_tests: bool) {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    let number = unsafe { libc::getenv(AUDIT_PASS_FD_ENV.as_ptr()) };
    if number.is_null() {
        return;
    }
    // SAFETY: not null, so a NUL-terminated string, which nothing changes.
    let Some(fd) = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok().and_then(|it| it.parse::<i32>().ok()) else { return };
    let asked = read_fd_to_end(fd).unwrap_or_default();
    let of_kind = |kind: u8| -> Vec<Vec<u8>> { bun_core::strings::split(&asked, b"\0").filter(|it| it.first() == Some(&kind)).map(|it| it[1..].to_vec()).collect() };
    let (entry_points, code) = (of_kind(b'E'), of_kind(b'C'));
    let start = retained::Start::new(&entry_points, is_for_tests, is_enforcing());
    if let Some(start) = &start {
        start.exit_when_superseded();
        bun_sema_driver::fs_queries::begin(retained::hash);
        start.record_settings();
    }
    let (given, hinted) = if is_enforcing() { (&[][..], &code[..]) } else { (&code[..], &[][..]) };
    let is_result_cacheable = run_on_new_thread(|| analyze_whole_program(&entry_points, given, hinted, is_for_tests, None, Audited::WholeProgramInBackground));
    let bytes = STATE.lock().as_ref().map_or_else(Vec::new, State::to_bytes);
    let queries = bun_sema_driver::fs_queries::end();
    let bytes = match (&start, queries) {
        (Some(start), _) if HAS_BUILD_BLOCKING_ERROR.load(Ordering::Acquire) => {
            start.forget();
            [&STOPS[..], &RENDERED_DIAGNOSTICS.lock()[..]].concat()
        }
        (Some(start), Some(queries)) if is_result_cacheable => {
            let threads = usize::from(bun_core::get_thread_count()).min(16);
            if bun_sema_driver::fs_queries::changed_answers(&queries, retained::hash, threads).is_empty() {
                start.put(&queries, &PUBLIC_DECLARATIONS.lock(), &RENDERED_DIAGNOSTICS.lock(), &bytes);
            }
            bytes
        }
        _ => bytes,
    };
    let mut at = 0;
    // SAFETY: ftruncate(2) takes no pointers.
    unsafe { libc::ftruncate(fd, 0) };
    while at < bytes.len() {
        // SAFETY: the rest of `bytes` is readable for that many bytes.
        let written = unsafe { libc::pwrite(fd, bytes[at..].as_ptr().cast(), bytes.len() - at, at as libc::off_t) };
        if written <= 0 {
            // SAFETY: _exit(2) has no preconditions.
            unsafe { libc::_exit(1) };
        }
        at += written as usize;
    }
    // SAFETY: _exit(2) has no preconditions.
    unsafe { libc::_exit(0) };
}

#[cfg(not(unix))]
fn take_inherited_state() -> Option<State> {
    None
}

pub(crate) fn preload_paths(vm: &mut bun_jsc::virtual_machine::VirtualMachine) -> Vec<Vec<u8>> {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
    let named = vm.preload.clone();
    (named.iter())
        .filter_map(|preload| {
            let name = preload.strip_prefix(b"file://".as_slice()).unwrap_or(preload);
            if name.starts_with(b"node:") || name.starts_with(b"bun:") {
                return None;
            }
            match vm.transpiler.resolver.resolve_and_auto_install(top_level_dir, name, bun_ast::ImportKind::Stmt, bun_resolver::GlobalCache::read_only) {
                bun_resolver::ResultUnion::Success(found) => found.path_const().filter(|path| path.is_file()).map(|path| path.text.to_vec()),
                _ => None,
            }
        })
        .collect()
}

pub(crate) fn prepare(entry_points: &[EntryPoint], before_read: Option<bun_sema_driver::host::BeforeRead>, is_for_tests: bool) -> bool {
    IS_WATCH_MODE.store(before_read.is_some(), Ordering::Release);
    #[cfg(unix)]
    analyze_for_parent_process(is_for_tests);
    let paths: Vec<Vec<u8>> = entry_points.iter().map(|it| it.path.to_vec()).collect();
    let handed_over = take_inherited_state().filter(|_| !is_enforcing());
    let is_inherited = handed_over.is_some();
    let mut awaits_whole_program_analysis = false;
    #[cfg(unix)]
    let start = retained::Start::new(&paths, is_for_tests, is_enforcing());
    #[cfg(unix)]
    let taken = start.as_ref().and_then(retained::Start::take);
    #[cfg(unix)]
    let mut retained = taken.as_ref().and_then(|taken| State::from_bytes(&taken.tables));
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut hinted: Vec<Vec<u8>> = Vec::new();
    #[cfg(unix)]
    if taken.as_ref().is_some_and(|taken| !taken.holds) {
        hinted = retained.take().map_or_else(Vec::new, |state| state.code);
    }
    #[cfg(unix)]
    if let (Some(state), Some(taken)) = (&mut retained, &taken)
        && !taken.changed.is_empty()
    {
        let entries: Vec<EntryPoint> = paths.iter().chain(taken.changed.iter().filter(|path| !paths.contains(path))).map(|path| EntryPoint::file(path)).collect();
        let changed = Audited::Changed { paths: &taken.changed, public_declarations: &taken.public_declarations };
        let more_code = MoreCode { paths: &state.code, ..Default::default() };
        let found = run_on_new_thread(|| audit_before(&entries, None, is_for_tests, changed, more_code, None)).unwrap_or_default();
        if found.public_declarations_changed || found.has_build_blocking_error {
            log_verbose(if found.has_build_blocking_error { "type errors in changed files: falling back to a full check" } else { "exported types changed: falling back to a full check" });
            hinted = core::mem::take(&mut state.code);
            retained = None;
        } else {
            let cwd = crate::cli::check_command::working_directory();
            for (module, text) in &found.modules {
                state.add(&cwd, module, text, Confidence::Unsure);
            }
            state.awaits_whole_program_analysis = true;
            awaits_whole_program_analysis = true;
            log_verbose(&format!("incremental check: {} changed, exported types unchanged", taken.changed.len()));
        }
    }
    #[cfg(not(unix))]
    let retained: Option<State> = None;
    let is_kept = retained.is_some();
    #[cfg(unix)]
    if let (true, Some(taken)) = (is_kept, &taken) {
        if let Some(before_read) = &before_read {
            taken.read.iter().for_each(|path| before_read(path));
        }
        let _ = bun_core::Output::error_writer().write_all(&taken.said);
        bun_core::Output::flush();
    }
    if !awaits_whole_program_analysis {
        log_verbose(if is_kept { "cache hit" } else { "full check" });
    }
    let (handed_over, is_inherited) = if is_kept { (None, false) } else { (handed_over, is_inherited) };
    awaits_whole_program_analysis |= handed_over.as_ref().is_some_and(|state| state.awaits_whole_program_analysis);
    *STATE.lock() = Some(State {
        entry_points: paths.clone(),
        is_for_tests,
        ..handed_over.or(retained).unwrap_or_default()
    });
    if !is_inherited && !is_kept {
        #[cfg(unix)]
        if let Some(start) = &start {
            bun_sema_driver::fs_queries::begin(retained::hash);
            start.record_settings();
        }
        let is_result_cacheable = run_on_new_thread(|| analyze_whole_program(&paths, &[], &hinted, is_for_tests, before_read, Audited::Whole));
        #[cfg(unix)]
        if let Some(start) = &start
            && let Some(queries) = bun_sema_driver::fs_queries::end()
            && is_result_cacheable
            && let Some(tables) = STATE.lock().as_ref().filter(|state| !state.awaits_whole_program_analysis).map(State::to_bytes)
        {
            start.put(&queries, &PUBLIC_DECLARATIONS.lock(), &RENDERED_DIAGNOSTICS.lock(), &tables);
        }
        #[cfg(not(unix))]
        let _ = is_result_cacheable;
    }
    LAST_REQUEST_MS.store(milliseconds(), Ordering::Release);
    bun_ast::audited::set_finish(finish);
    bun_ast::audited::set_table_source(table_for);
    if is_inherited {
        reanalyze_changed_files();
    }
    if awaits_whole_program_analysis {
        STARTS_IMMEDIATELY.store(is_kept, Ordering::Release);
        #[cfg(unix)]
        if let Some(start) = &start {
            start.write_ticket();
        }
        analyze_whole_program_in_background();
        #[cfg(unix)]
        for _ in 0..200 {
            if !is_kept || *CHILD.lock() != 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
    }
    #[cfg(unix)]
    bun_core::before_reload(pass_state_to_child);
    !IS_STOPPED.load(Ordering::Acquire)
}

pub(crate) fn is_on() -> bool {
    bun_ast::audited::is_on()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOTAudit__waitForWholeProgramAnalysis() -> u32 {
    let is_in_progress = || IS_ANALYZING_WHOLE_PROGRAM.load(Ordering::Acquire) || STATE.lock().as_ref().is_some_and(|state| state.awaits_whole_program_analysis);
    if !is_in_progress() {
        return 0;
    }
    let begun = milliseconds();
    while is_in_progress() {
        LAST_REQUEST_MS.store(0, Ordering::Release);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    log_verbose(&format!("a runtime type check failed and waited {} ms for the background full check", milliseconds() - begun));
    STATE.lock().as_ref().map_or(0, |state| state.generation)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__installFor(global: *mut bun_jsc::JSGlobalObject) {
    let cwd = crate::cli::check_command::working_directory();
    // SAFETY: `global` is the caller's live global object. C++ copies both texts during the call.
    unsafe { Bun__AOTAudit__install(global, HELPER.as_ptr(), HELPER.len(), cwd.as_ptr(), cwd.len()) };
}

fn finish(written: &[u8]) -> Option<Box<bun_ast::audited::Finished>> {
    bun_ast::audited::current()?;
    let PrintedAudit { expressions, parameters } = bun_ast::audited::take_printed();
    bun_ast::audited::set_current(None);
    let state = STATE.lock();
    let state = state.as_ref()?;
    let is_enforcing = u32::from(IS_ENFORCING.load(Ordering::Acquire)) << 11;
    let of = |id: u32| state.described.get(id as usize).map_or([0, 1, 0], |it| [it.passes | is_enforcing, it.minimum as u32, it.maximum as u32]);
    let expressions: Vec<[u32; 6]> = (expressions.iter())
        .map(|&[mut start, mut end, id]| {
            while start < end && written.get(start as usize).is_some_and(u8::is_ascii_whitespace) {
                start += 1;
            }
            while start < end && written.get(end as usize - 1).is_some_and(u8::is_ascii_whitespace) {
                end -= 1;
            }
            let [passes, minimum, maximum] = of(id);
            [start, end, id, passes, minimum, maximum]
        })
        .collect();
    let parameters: Vec<[u32; 6]> = (parameters.iter())
        .map(|&[function, index, id]| {
            let [passes, minimum, maximum] = of(id);
            [function, index, id, passes, minimum, maximum]
        })
        .collect();
    Some(Box::new(bun_ast::audited::Finished {
        written_len: written.len(),
        expressions,
        parameters,
    }))
}

pub(crate) fn end_file(written: &[u8]) {
    match finish(written) {
        // SAFETY: the two lists are valid for the call, and C++ copies them.
        Some(it) => unsafe { Bun__AOTAudit__setPendingSites(it.written_len, it.expressions.as_ptr(), it.expressions.len(), it.parameters.as_ptr(), it.parameters.len()) },
        // SAFETY: C++ reads neither pointer when the counts are 0.
        None if is_on() => unsafe { Bun__AOTAudit__setPendingSites(0, core::ptr::null(), 0, core::ptr::null(), 0) },
        None => {}
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__describe(id: u32, out: *mut bun_core::String) {
    let state = STATE.lock();
    let text = state.as_ref().and_then(|state| state.described.get(id as usize)).map_or("{\"steps\":[]}", |it| &*it.text);
    // SAFETY: `out` is the caller's out-parameter, which holds no string yet.
    unsafe { out.write(bun_core::String::clone_utf8(text.as_bytes())) };
}

pub(crate) fn enable() {
    IS_ENABLED.store(true, Ordering::Release);
}

pub(crate) fn enforce() {
    IS_ENFORCING.store(true, Ordering::Release);
    bun_ast::audited::keep_directives();
}

pub(crate) fn is_enforcing() -> bool {
    IS_ENFORCING.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__isEnforcing() -> bool {
    IS_ENFORCING.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__isEnabled() -> bool {
    IS_ENABLED.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__writeRejectedChange(
    kind: *const u8,
    kind_len: usize,
    message: &bun_core::String,
    function_name: &bun_core::String,
    source_url: &bun_core::String,
    line: i32,
    column: i32,
) {
    // SAFETY: `kind[..kind_len]` is the caller's live buffer.
    let kind = core::str::from_utf8(unsafe { core::slice::from_raw_parts(kind, kind_len) }).unwrap_or_default();
    let cwd = crate::cli::check_command::working_directory();
    let path = source_url.to_owned_slice();
    let shown = path.strip_prefix(&cwd[..]).and_then(|rest| rest.strip_prefix(b"/")).unwrap_or(&path);
    let function_name = function_name.to_owned_slice();
    let function_name: &[u8] = if function_name.is_empty() { b"<anonymous>" } else { &function_name };
    let (line, column) = (line.max(0) as usize, column.max(0) as usize);
    let id = bun_aot::audit::id_of(shown, line, column, kind, 0);
    let message = message.to_owned_slice();
    let record = if log().1 {
        let quoted = |text: &[u8]| bun_aot::audit::quoted_text(text);
        format!(
            "{{\"aot\":\"type-error\",\"id\":\"{id}\",\"kind\":\"{kind}\",\"file\":{},\"line\":{line},\"col\":{column},\"fn\":{},\"reason\":{},\"action\":\"would-refuse\",\"count\":1}}\n",
            quoted(shown),
            quoted(function_name),
            quoted(&message),
        )
    } else {
        format!("[aot] type-error {id} {kind} {}:{line}:{column} ({}): {}; would-refuse; count 1\n", bstr::BStr::new(shown), bstr::BStr::new(function_name), bstr::BStr::new(&message))
    };
    write_record(record.as_bytes());
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__describeShape(key: &bun_core::String, out: *mut bun_core::String) {
    let key = key.to_owned_slice();
    let state = STATE.lock();
    let text = match (state.as_ref(), core::str::from_utf8(&key)) {
        (Some(state), Ok("")) => state.generation.to_string(),
        (_, Ok("format")) => String::from(if log().1 { "json" } else { "text" }),
        (_, Ok("isEnforcing")) => IS_ENFORCING.load(Ordering::Acquire).to_string(),
        (_, Ok("logs")) => (log().0 >= 0).to_string(),
        (Some(state), Ok(key)) => state.shapes.get(key).map_or_else(|| String::from("null"), |text| text.to_string()),
        _ => String::from("null"),
    };
    // SAFETY: `out` is the caller's out-parameter, which holds no string yet.
    unsafe { out.write(bun_core::String::clone_utf8(text.as_bytes())) };
}
