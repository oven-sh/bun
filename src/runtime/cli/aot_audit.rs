use bun_ast::audited::{AuditedExpression, AuditedFile, AuditedParameter, AuditedValidation, PrintedAudit};
use bun_sema_driver::FxHashMap as HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use bun_threading::Guarded;

use crate::cli::check_command::{Audited, EntryPoint, audit_before};

struct Described {
    passes: u32,
    least: i32,
    most: i32,
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
    waits_for_the_whole: bool,
    entry_points: Vec<Vec<u8>>,
    code: Vec<Vec<u8>>,
    is_for_tests: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Trust {
    Sure,
    Unsure,
    Silent,
}

impl Trust {
    fn text(self) -> &'static str {
        match self {
            Trust::Sure => "",
            Trust::Unsure => "\"unsure\":true,",
            Trust::Silent => "\"unsure\":true,\"silent\":true,",
        }
    }
}

static STATE: Guarded<Option<State>> = Guarded::new(None);
static IS_LOOKING_AT_THE_WHOLE: AtomicBool = AtomicBool::new(false);
static IS_WANTED: AtomicBool = AtomicBool::new(false);
static ACTS: AtomicBool = AtomicBool::new(false);
static LAST_ASKED: AtomicU64 = AtomicU64::new(0);
static SEEN_BY_OTHERS: Guarded<Vec<(Vec<u8>, u64, Vec<u8>)>> = Guarded::new(Vec::new());
static BEGINS_AT_ONCE: AtomicBool = AtomicBool::new(false);
static STOPS_A_BUILD: AtomicBool = AtomicBool::new(false);
#[cfg(unix)]
const STOPS: &[u8] = b"what stops a build\0";

fn say_which_road(text: &str) {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    if unsafe { libc::getenv(c"BUN_AOT_VERBOSE".as_ptr()) }.is_null() {
        return;
    }
    let line = format!("[aot] look: {text}\n");
    bun_core::Output::flush();
    // SAFETY: `line` is readable for `line.len()` bytes.
    unsafe { libc::write(2, line.as_ptr().cast(), line.len()) };
}
static SAID: Guarded<Vec<u8>> = Guarded::new(Vec::new());
/// The test files that `bun test --aot` does not run: a file with a type error is reached from them.
static LEFT_OUT: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());

pub(crate) fn is_left_out_for_type_errors(entry_point: &[u8]) -> bool {
    LEFT_OUT.lock().iter().any(|path| path == entry_point)
}
static IS_WATCHED: AtomicBool = AtomicBool::new(false);
static IS_STOPPED: AtomicBool = AtomicBool::new(false);
static LOOKED_AT_ALONE: Guarded<std::collections::BTreeSet<Vec<u8>>> = Guarded::new(std::collections::BTreeSet::new());
static IS_LOOKED_AT: bun_threading::Condvar = bun_threading::Condvar::new();
#[cfg(unix)]
static CHILD: Guarded<i32> = Guarded::new(0);

const HELPER: &str = include_str!("aot_audit.js");
const HANDED_OVER: &core::ffi::CStr = c"BUN_INTERNAL_AOT_AUDIT_FD";
#[cfg(unix)]
const LOOKS_FOR_ANOTHER: &core::ffi::CStr = c"BUN_INTERNAL_AOT_AUDIT_PASS_FD";

unsafe extern "C" {
    fn Bun__AOTAudit__install(
        global: *mut bun_jsc::JSGlobalObject,
        source: *const u8,
        length: usize,
        cwd: *const u8,
        length_of_cwd: usize,
    );
    fn Bun__AOTAudit__setPendingSites(
        length_of_source: usize,
        expressions: *const [u32; 6],
        number_of_expressions: usize,
        parameters: *const [u32; 6],
        number_of_parameters: usize,
    );
    fn Bun__AOTAudit__setGeneration(generation: u32);
}

fn note(text: &str) {
    if acts() {
        return;
    }
    let line = format!("[aot] note: {text}\n");
    bun_core::Output::flush();
    // SAFETY: `line` is readable for `line.len()` bytes.
    unsafe { libc::write(2, line.as_ptr().cast(), line.len()) };
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
            None if ACTS.load(Ordering::Acquire) => (-1, false),
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

fn text_of_group(shown: &str, trust: Trust, group: &bun_aot::audit::Group) -> Box<str> {
    let unsure = trust.text();
    format!("{{\"file\":{shown},{unsure}\"step\":{},\"steps\":[{}]}}", group.step, group.steps).into_boxed_str()
}

fn text_of_parameter(shown: &str, trust: Trust, parameter: &bun_aot::audit::Parameter) -> Box<str> {
    let unsure = trust.text();
    format!("{{\"file\":{shown},{unsure}\"parameter\":true,\"steps\":[{}]}}", parameter.step).into_boxed_str()
}

impl State {
    fn add(&mut self, cwd: &[u8], module: &bun_aot::audit::Module, text: &[u8], trust: Trust) -> &'static AuditedFile {
        self.waits_for_the_whole |= trust != Trust::Sure;
        let shown = bun_aot::audit::quoted_text(&module.path);
        let mut audited = AuditedFile {
            hash_of_text: hash_of(text),
            ..Default::default()
        };
        let (mut groups, mut parameters) = (HashMap::default(), HashMap::default());
        for group in &module.groups {
            let id = self.described.len() as u32;
            self.described.push(Described {
                passes: if group.step != 0 { 0 } else { group.passes },
                least: group.least,
                most: group.most,
                text: text_of_group(&shown, trust, group),
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
                least: parameter.least,
                most: parameter.most,
                text: text_of_parameter(&shown, trust, parameter),
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

    fn add_without_sites(&mut self, path: &[u8], hash_of_text: u64) -> &'static AuditedFile {
        // SAFETY: as in `add`.
        let audited: &'static AuditedFile = unsafe {
            &*bun_core::heap::alloc(AuditedFile {
                hash_of_text,
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
            if ours.is_some_and(|ours| ours.audited.hash_of_text == theirs.audited.hash_of_text) {
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
                    self.described.push(Described { passes: it.passes, least: it.least, most: it.most, text: it.text.clone() });
                }
                let mut audited = AuditedFile {
                    hash_of_text: theirs.audited.hash_of_text,
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
        self.is_renewed();
    }

    fn is_renewed(&mut self) {
        self.generation += 1;
        // SAFETY: it stores the number.
        unsafe { Bun__AOTAudit__setGeneration(self.generation) };
    }

    fn refine(&mut self, cwd: &[u8], module: &bun_aot::audit::Module, text: &[u8]) {
        let Some(file) = self.files.get(&native_path(cwd, &module.path)) else {
            self.add(cwd, module, text, Trust::Sure);
            return;
        };
        if file.audited.hash_of_text != hash_of(text) {
            return;
        }
        let shown = bun_aot::audit::quoted_text(&module.path);
        let mut texts: HashMap<u32, Box<str>> = HashMap::default();
        for &id in file.groups.values().chain(file.parameters.values()) {
            texts.insert(id, Box::from("{\"steps\":[]}"));
        }
        for group in &module.groups {
            if let Some(&id) = file.groups.get(&(group.start, group.end, group.step)) {
                texts.insert(id, text_of_group(&shown, Trust::Sure, group));
            }
        }
        for parameter in &module.parameters {
            if let Some(&id) = file.parameters.get(&(parameter.function, parameter.index)) {
                texts.insert(id, text_of_parameter(&shown, Trust::Sure, parameter));
            }
        }
        for (id, text) in texts {
            self.described[id as usize].text = text;
        }
    }
}

fn on_a_thread_of_its_own<T: Send>(run: impl FnOnce() -> T + Send) -> T {
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

fn look_at_the_whole(entry_points: &[Vec<u8>], code: &[Vec<u8>], hinted: &[Vec<u8>], is_for_tests: bool, before_read: Option<bun_sema_driver::host::BeforeRead>, audited: Audited<'_>) -> bool {
    let cwd = crate::cli::check_command::working_directory();
    let mut entry_points = entry_points.to_vec();
    let (mut code, mut before_read) = (code.to_vec(), before_read);
    let (given, mut taken_out) = (code.len(), Vec::new());
    code.extend_from_slice(hinted);
    let found = loop {
        let entries: Vec<EntryPoint> = entry_points.iter().map(|path| EntryPoint::file(path)).collect();
        let mut found = audit_before(&entries, before_read.take(), is_for_tests, audited, &code, None).unwrap_or_default();
        if !found.not_in_the_program.is_empty() && code.len() > given {
            code.retain(|path| !found.not_in_the_program.contains(path));
            taken_out.append(&mut found.not_in_the_program);
            continue;
        }
        if !found.never_visited.is_empty() {
            code.append(&mut found.never_visited);
            for path in found.may_be_visited {
                if !code.contains(&path) && !taken_out.contains(&path) {
                    code.push(path);
                }
            }
            continue;
        }
        if found.reach_errors.is_empty() || found.reach_errors.len() == entry_points.len() || !matches!(audited, Audited::Whole) || !ACTS.load(Ordering::Acquire) || IS_WATCHED.load(Ordering::Acquire) {
            break found;
        }
        entry_points.retain(|path| !found.reach_errors.contains(path));
        LEFT_OUT.lock().append(&mut found.reach_errors);
    };
    if found.stops_a_build && matches!(audited, Audited::Whole) && ACTS.load(Ordering::Acquire) {
        bun_core::Output::flush();
        if !IS_WATCHED.load(Ordering::Acquire) {
            bun_core::Global::exit(1);
        }
        IS_STOPPED.store(true, Ordering::Release);
    }
    let mut state = STATE.lock();
    let state = state.get_or_insert_with(State::default);
    state.entry_points.retain(|path| !is_left_out_for_type_errors(path));
    for path in code {
        if !state.code.contains(&path) {
            state.code.push(path);
        }
    }
    for (module, text) in &found.modules {
        state.refine(&cwd, module, text);
    }
    state.shapes = found.shapes.into_iter().map(|(key, text)| (key, text.into_boxed_str())).collect();
    state.is_renewed();
    *SAID.lock() = found.said;
    STOPS_A_BUILD.store(found.stops_a_build, Ordering::Release);
    *SEEN_BY_OTHERS.lock() = found.seen_by_others;
    !found.stops_a_build && !found.has_errors && LEFT_OUT.lock().is_empty()
}

/// A look that is kept from one start to the next, see `bun_sema_driver::asked`.
#[cfg(unix)]
mod kept {
    use bun_sema_driver::asked::{Kind, Question};
    use std::sync::atomic::{AtomicBool, Ordering};

    const MAGIC: &[u8; 8] = b"bunlook3";

    const MOST_KEPT: u64 = 1 << 30;
    static IS_WRITING: AtomicBool = AtomicBool::new(false);

    pub(super) struct Taken {
        pub(super) read: Vec<Vec<u8>>,
        pub(super) said: Vec<u8>,
        pub(super) tables: Vec<u8>,
        /// What is answered otherwise.
        pub(super) changed: Vec<Vec<u8>>,
        /// Nothing is answered otherwise but the texts of TypeScript files of the program itself.
        pub(super) holds: bool,
        pub(super) seen_by_others: Vec<(Vec<u8>, u64, Vec<u8>)>,
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

    /// How this process was started, as far as a look depends on it, and the files of settings that Bun itself has read.
    pub(super) struct Start {
        key: Vec<u8>,
        path: Vec<u8>,
        settings: Vec<Vec<u8>>,
    }

    impl Start {
        pub(super) fn of(entry_points: &[Vec<u8>], is_for_tests: bool, acts: bool) -> Option<Start> {
            let folder = folder()?;
            let executable = bun_core::self_exe_path().ok()?;
            // SAFETY: `stat` is plain data for which all zeros is a valid value.
            let mut found: libc::stat = unsafe { bun_core::ffi::zeroed_unchecked() };
            // SAFETY: the path is NUL-terminated and `found` is a valid out-param.
            if unsafe { libc::stat(executable.as_ptr().cast(), &mut found) } != 0 {
                return None;
            }
            let cwd = crate::cli::check_command::working_directory();
            let form = crate::cli::check_command::form_of_what_is_said();
            let mut key = format!("{} {} {} {} {is_for_tests} {acts} {form:?}\0", bun_core::Global::package_json_version_with_sha, found.st_size, found.st_mtime, found.st_mtime_nsec).into_bytes();
            for part in [executable.as_bytes(), &cwd[..]] {
                key.extend_from_slice(part);
                key.push(0);
            }
            let names_the_entry = |argument: &[u8]| {
                let written = argument.strip_prefix(b"./").unwrap_or(argument);
                !argument.starts_with(b"-") && !written.is_empty() && entry_points.iter().any(|path| path.ends_with(written))
            };
            for argument in bun_core::argv().into_iter().skip(1).filter(|it| !matches!(*it, b"--watch" | b"--hot")) {
                key.extend_from_slice(argument);
                key.push(0);
                if names_the_entry(argument) {
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

        /// What the look that was kept for a start like this one had to say, its tables, the files it had read, and whether the disk still
        /// answers as it did.
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
            let mut questions = Vec::new();
            for _ in 0..count {
                let (kind, answer) = (Kind::from_number(number(&mut rest)?)?, number(&mut rest)?);
                questions.push(Question { kind, path: bytes(&mut rest)?, answer });
            }
            let count = usize::try_from(number(&mut rest)?).ok()?;
            let mut seen_by_others = Vec::new();
            for _ in 0..count {
                let seen = number(&mut rest)?;
                let path = bytes(&mut rest)?;
                seen_by_others.push((path, seen, bytes(&mut rest)?));
            }
            let said = bytes(&mut rest)?;
            let threads = usize::from(bun_core::get_thread_count()).min(16);
            let mut holds = true;
            let mut changed = Vec::new();
            for at in bun_sema_driver::asked::answered_otherwise(&questions, hash, threads) {
                let path = bun_sema_driver::host::to_native(&questions[at].path).to_vec();
                holds &= questions[at].kind == Kind::Text && seen_by_others.iter().any(|it| it.0 == path);
                changed.push(path);
            }
            let read = questions.into_iter().filter(|question| question.kind == Kind::Text).map(|question| question.path).collect();
            Some(Taken { read, said, tables: rest.to_vec(), changed, seen_by_others, holds })
        }

        pub(super) fn note_settings(&self) {
            for path in &self.settings {
                let text = bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok();
                bun_sema_driver::asked::note(Kind::NativeText, path, |hash| bun_sema_driver::asked::of_text(hash, text.as_deref()));
            }
        }

        fn ticket_path(&self) -> Vec<u8> {
            [self.path.strip_suffix(b".look").unwrap_or(&self.path), b".ticket"].concat()
        }

        /// From here on only a child that is started now goes on.
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

        /// Ends the process as soon as another ticket is written.
        pub(super) fn end_at_another_ticket(&self) {
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

        pub(super) fn put(&self, questions: &[Question], seen_by_others: &[(Vec<u8>, u64, Vec<u8>)], said: &[u8], tables: &[u8]) {
            let mut rest = Vec::with_capacity(tables.len() + questions.len() * 96);
            let bytes = |rest: &mut Vec<u8>, value: &[u8]| {
                rest.extend_from_slice(&(value.len() as u64).to_le_bytes());
                rest.extend_from_slice(value);
            };
            bytes(&mut rest, &self.key);
            rest.extend_from_slice(&(questions.len() as u64).to_le_bytes());
            for question in questions {
                rest.extend_from_slice(&(question.kind as u64).to_le_bytes());
                rest.extend_from_slice(&question.answer.to_le_bytes());
                bytes(&mut rest, &question.path);
            }
            rest.extend_from_slice(&(seen_by_others.len() as u64).to_le_bytes());
            for (path, seen, declarations) in seen_by_others {
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
            self.make_room();
        }

        /// The kept looks take `MOST_KEPT` bytes at most: the oldest go first, this one never. So does what a writer that died left behind.
        fn make_room(&self) {
            let Some(slash) = self.path.iter().rposition(|&byte| byte == b'/') else { return };
            let Ok(folder) = std::ffi::CString::new(&self.path[..slash]) else { return };
            // SAFETY: the path is NUL-terminated.
            let directory = unsafe { libc::opendir(folder.as_ptr()) };
            if directory.is_null() {
                return;
            }
            // SAFETY: time(2) takes a null pointer.
            let now = unsafe { libc::time(core::ptr::null_mut()) };
            let mut kept = Vec::new();
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
                    kept.push(((found.st_mtime, found.st_mtime_nsec), found.st_size.max(0) as u64, path));
                } else if now - found.st_mtime > 600 {
                    // SAFETY: the path is NUL-terminated.
                    unsafe { libc::unlink(path.as_ptr()) };
                }
            }
            // SAFETY: `directory` is open and is not used again.
            unsafe { libc::closedir(directory) };
            kept.sort();
            let mut all: u64 = kept.iter().map(|it| it.1).sum();
            for (_, size, path) in kept {
                if all <= MOST_KEPT {
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
fn look_at_the_whole_in_a_child(entry_points: &[Vec<u8>], code: &[Vec<u8>]) -> Option<State> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::process::CommandExt;
    let asked: Vec<Vec<u8>> = (entry_points.iter().map(|it| [&b"E"[..], &it[..]].concat())).chain(code.iter().map(|it| [&b"C"[..], &it[..]].concat())).collect();
    let fd = unlinked_file_with(&asked.join(&0u8))?;
    let found = (|| {
        let executable = bun_core::self_exe_path().ok()?;
        #[allow(clippy::disallowed_types)]
        let mut command = std::process::Command::new(std::ffi::OsStr::from_bytes(executable.as_bytes()));
        for argument in bun_core::argv().into_iter().skip(1).filter(|it| !matches!(*it, b"--watch" | b"--hot")) {
            command.arg(std::ffi::OsStr::from_bytes(argument));
        }
        command.env(std::ffi::OsStr::from_bytes(LOOKS_FOR_ANOTHER.to_bytes()), fd.to_string());
        command.env_remove(std::ffi::OsStr::from_bytes(HANDED_OVER.to_bytes()));
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
        let bytes = read_whole(fd)?;
        if let Some(said) = bytes.strip_prefix(STOPS) {
            if acts() {
                let _ = bun_core::Output::error_writer().write_all(said);
                bun_core::Output::flush();
                if !IS_WATCHED.load(Ordering::Acquire) {
                    bun_core::Global::exit(1);
                }
            }
            return None;
        }
        State::from_bytes(&bytes)
    })();
    // SAFETY: `fd` is ours, from `unlinked_file_with`, and is not used again.
    unsafe { libc::close(fd) };
    found
}

#[cfg(unix)]
fn stop_the_child() {
    let mut running = CHILD.lock();
    if *running > 0 {
        // SAFETY: kill(2) takes no pointers. `CHILD` holds the id only while the child has not been
        // waited for, so it names no other process.
        unsafe { libc::kill(*running, libc::SIGKILL) };
    }
    *running = 0;
}

#[cfg(not(unix))]
fn stop_the_child() {}

fn look_at_the_whole_in_the_background() {
    stop_the_child();
    if IS_LOOKING_AT_THE_WHOLE.swap(true, Ordering::AcqRel) {
        return;
    }
    let still_waits = || STATE.lock().as_ref().is_some_and(|state| state.waits_for_the_whole);
    let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        while still_waits() {
            while !BEGINS_AT_ONCE.load(Ordering::Acquire) && milliseconds().saturating_sub(LAST_ASKED.load(Ordering::Acquire)) < 300 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let Some((entry_points, code, is_for_tests)) = STATE.lock().as_mut().map(|state| {
                state.waits_for_the_whole = false;
                (state.entry_points.clone(), state.code.clone(), state.is_for_tests)
            }) else {
                break;
            };
            #[cfg(unix)]
            {
                let _ = is_for_tests;
                let found = look_at_the_whole_in_a_child(&entry_points, &code);
                if let (Some(found), Some(state)) = (found, STATE.lock().as_mut()) {
                    state.merge(found);
                }
            }
            #[cfg(not(unix))]
            look_at_the_whole(&entry_points, &code, &[], is_for_tests, None, Audited::WholeInTheBackground);
        }
        bun_core::Output::flush();
        IS_LOOKING_AT_THE_WHOLE.store(false, Ordering::Release);
        if still_waits() {
            look_at_the_whole_in_the_background();
        }
    });
    if thread.is_err() {
        IS_LOOKING_AT_THE_WHOLE.store(false, Ordering::Release);
    }
}

fn hash_of(text: &[u8]) -> u64 {
    bun_wyhash::hash(bun_core::strings::without_utf8_bom(text))
}

fn milliseconds() -> u64 {
    static BEGUN: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    BEGUN.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

fn known(path: &[u8], hash: u64) -> Option<Option<&'static AuditedFile>> {
    let state = STATE.lock();
    let Some(state) = state.as_ref() else { return Some(None) };
    match state.files.get(path) {
        Some(file) if file.audited.hash_of_text == hash => Some(Some(file.audited)),
        Some(_) => None,
        None if !State::may_have_a_table(path) => Some(None),
        None => None,
    }
}

fn look_at_it_alone(path: &[u8], text: &[u8]) -> Option<&'static AuditedFile> {
    let hash = hash_of(text);
    let mut looked_at = LOOKED_AT_ALONE.lock();
    loop {
        if let Some(found) = known(path, hash) {
            return found;
        }
        if looked_at.insert(path.to_vec()) {
            let (its_path, its_text) = (path.to_vec(), text.to_vec());
            let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
                bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
                look_at_this_alone(&its_path, &its_text, hash);
                bun_core::Output::flush();
            });
            if thread.is_err() {
                looked_at.remove(path);
                return None;
            }
        }
        IS_LOOKED_AT.wait_guarded(&mut looked_at);
    }
}

fn look_at_this_alone(path: &[u8], text: &[u8], hash: u64) {
    stop_the_child();
    let (mut entry_points, is_for_tests, is_known_to_the_whole) = {
        let state = STATE.lock();
        state.as_ref().map_or_else(Default::default, |state| (state.entry_points.clone(), state.is_for_tests, state.files.contains_key(path)))
    };
    static NEVER_SEEN: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let is_looked_at = is_known_to_the_whole || NEVER_SEEN.fetch_add(1, Ordering::AcqRel) < 8;
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
                let trust = if is_known_to_the_whole || !is_of_a_package { Trust::Unsure } else { Trust::Silent };
                is_added = state.add(&cwd, module, text, trust).hash_of_text == hash;
                if !is_added {
                    note(&format!("{} is not audited: the analysis read a different text of this file than the one that runs (a direct eval(), a loader plugin, or an edit while it loaded)", bstr::BStr::new(&module.path)));
                }
            }
            if !is_added {
                state.add_without_sites(path, hash);
            }
            if !is_known_to_the_whole && !state.code.iter().any(|known| known == path) {
                state.code.push(path.to_vec());
                state.waits_for_the_whole = true;
            }
        }
        LOOKED_AT_ALONE.lock().remove(path);
        IS_LOOKED_AT.notify_all();
    };
    let entries: Vec<EntryPoint> = entry_points.iter().map(|path| EntryPoint::file(path)).collect();
    struct TellsAtLast<'a>(&'a (dyn Fn(crate::cli::check_command::AuditFound) + Sync));
    impl Drop for TellsAtLast<'_> {
        fn drop(&mut self) {
            (self.0)(Default::default());
        }
    }
    let at_last = TellsAtLast(&tell);
    if is_looked_at {
        let _ = audit_before(&entries, None, is_for_tests, Audited::Alone { path, text, is_quiet: !is_known_to_the_whole }, &[], Some(&tell));
    }
    drop(at_last);
    look_at_the_whole_in_the_background();
}

fn table_for(path: &[u8], text: &[u8]) -> Option<&'static AuditedFile> {
    LAST_ASKED.store(milliseconds(), Ordering::Release);
    match known(path, hash_of(text)) {
        Some(found) => found,
        None if acts() => None,
        None => look_at_it_alone(path, text),
    }
}

fn look_at_what_has_changed() {
    let files: Vec<(Vec<u8>, u64)> = {
        let state = STATE.lock();
        state.as_ref().map_or_else(Vec::new, |state| state.files.iter().map(|(path, file)| (path.clone(), file.audited.hash_of_text)).collect())
    };
    let _ = std::thread::Builder::new().spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        for (path, hash) in files {
            if let Ok(text) = bun_sys::File::read_from(bun_sys::Fd::cwd(), &path)
                && hash_of(&text) != hash
            {
                look_at_it_alone(&path, &text);
            }
        }
        bun_core::Output::flush();
    });
}

impl State {
    fn may_have_a_table(path: &[u8]) -> bool {
        matches!(bun_paths::extension(path), b".ts" | b".tsx" | b".mts" | b".cts")
    }

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
            number(&mut out, u64::from(described.least as u32) << 32 | u64::from(described.most as u32));
            bytes(&mut out, described.text.as_bytes());
        }
        number(&mut out, u64::from(self.waits_for_the_whole || IS_LOOKING_AT_THE_WHOLE.load(Ordering::Acquire)));
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
            number(&mut out, file.audited.hash_of_text);
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
            state.described.push(Described { passes, least: (range >> 32) as u32 as i32, most: range as u32 as i32, text: Box::from(text) });
        }
        state.waits_for_the_whole = number(input)? != 0;
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
                hash_of_text: number(input)?,
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
            state.files.insert(path, File { audited, groups, parameters });
        }
        Some(state)
    }
}

#[cfg(unix)]
fn unlinked_file_with(bytes: &[u8]) -> Option<i32> {
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
fn hand_over() {
    stop_the_child();
    let state = STATE.lock();
    let Some(state) = state.as_ref() else { return };
    let Some(fd) = unlinked_file_with(&state.to_bytes()) else { return };
    bun_core::keep_open_over_reload(fd);
    let number = std::ffi::CString::new(fd.to_string()).expect("digits");
    // SAFETY: both strings are NUL-terminated; setenv copies them into libc env storage.
    unsafe { libc::setenv(HANDED_OVER.as_ptr(), number.as_ptr(), 1) };
}

#[cfg(unix)]
fn take_what_was_handed_over() -> Option<State> {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    let number = unsafe { libc::getenv(HANDED_OVER.as_ptr()) };
    if number.is_null() {
        return None;
    }
    // SAFETY: not null, so a NUL-terminated string. It is read before the variable is unset below.
    let fd: i32 = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok()?.parse().ok()?;
    // SAFETY: the name is NUL-terminated.
    unsafe { libc::unsetenv(HANDED_OVER.as_ptr()) };
    let bytes = read_whole(fd);
    // SAFETY: `fd` was kept open over the reload for this read and is not used again.
    unsafe { libc::close(fd) };
    State::from_bytes(&bytes?)
}

#[cfg(unix)]
fn read_whole(fd: i32) -> Option<Vec<u8>> {
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
fn look_for_another(is_for_tests: bool) {
    // SAFETY: getenv only reads, and the name is NUL-terminated.
    let number = unsafe { libc::getenv(LOOKS_FOR_ANOTHER.as_ptr()) };
    if number.is_null() {
        return;
    }
    // SAFETY: not null, so a NUL-terminated string, which nothing changes.
    let Some(fd) = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok().and_then(|it| it.parse::<i32>().ok()) else { return };
    let asked = read_whole(fd).unwrap_or_default();
    let of_kind = |kind: u8| -> Vec<Vec<u8>> { bun_core::strings::split(&asked, b"\0").filter(|it| it.first() == Some(&kind)).map(|it| it[1..].to_vec()).collect() };
    let (entry_points, code) = (of_kind(b'E'), of_kind(b'C'));
    let start = kept::Start::of(&entry_points, is_for_tests, acts());
    if let Some(start) = &start {
        start.end_at_another_ticket();
        bun_sema_driver::asked::begin(kept::hash);
        start.note_settings();
    }
    let (given, hinted) = if acts() { (&[][..], &code[..]) } else { (&code[..], &[][..]) };
    let may_be_kept = on_a_thread_of_its_own(|| look_at_the_whole(&entry_points, given, hinted, is_for_tests, None, Audited::WholeInTheBackground));
    let bytes = STATE.lock().as_ref().map_or_else(Vec::new, State::to_bytes);
    let questions = bun_sema_driver::asked::end();
    let bytes = match (&start, questions) {
        (Some(start), _) if STOPS_A_BUILD.load(Ordering::Acquire) => {
            start.forget();
            [&STOPS[..], &SAID.lock()[..]].concat()
        }
        (Some(start), Some(questions)) if may_be_kept => {
            let threads = usize::from(bun_core::get_thread_count()).min(16);
            if bun_sema_driver::asked::answered_otherwise(&questions, kept::hash, threads).is_empty() {
                start.put(&questions, &SEEN_BY_OTHERS.lock(), &SAID.lock(), &bytes);
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
fn take_what_was_handed_over() -> Option<State> {
    None
}

pub(crate) fn preloads_of(vm: &mut bun_jsc::virtual_machine::VirtualMachine) -> Vec<Vec<u8>> {
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

/// Whether the program may start. Type errors end the process, unless a file watcher is there to start it again.
pub(crate) fn prepare(entry_points: &[EntryPoint], before_read: Option<bun_sema_driver::host::BeforeRead>, is_for_tests: bool) -> bool {
    IS_WATCHED.store(before_read.is_some(), Ordering::Release);
    #[cfg(unix)]
    look_for_another(is_for_tests);
    let paths: Vec<Vec<u8>> = entry_points.iter().map(|it| it.path.to_vec()).collect();
    let handed_over = take_what_was_handed_over().filter(|_| !acts());
    let is_handed_over = handed_over.is_some();
    let mut waits_for_the_whole = false;
    #[cfg(unix)]
    let start = kept::Start::of(&paths, is_for_tests, acts());
    #[cfg(unix)]
    let taken = start.as_ref().and_then(kept::Start::take);
    #[cfg(unix)]
    let mut kept = taken.as_ref().and_then(|taken| State::from_bytes(&taken.tables));
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut hinted: Vec<Vec<u8>> = Vec::new();
    #[cfg(unix)]
    if taken.as_ref().is_some_and(|taken| !taken.holds) {
        hinted = kept.take().map_or_else(Vec::new, |state| state.code);
    }
    #[cfg(unix)]
    if let (Some(state), Some(taken)) = (&mut kept, &taken)
        && !taken.changed.is_empty()
    {
        let entries: Vec<EntryPoint> = paths.iter().chain(taken.changed.iter().filter(|path| !paths.contains(path))).map(|path| EntryPoint::file(path)).collect();
        let changed = Audited::Changed { paths: &taken.changed, seen_by_others: &taken.seen_by_others };
        let found = on_a_thread_of_its_own(|| audit_before(&entries, None, is_for_tests, changed, &state.code, None)).unwrap_or_default();
        if found.is_seen_otherwise || found.stops_a_build {
            say_which_road(if found.stops_a_build { "what has changed has errors: the whole look decides whether they stand" } else { "what has changed looks otherwise to other files" });
            hinted = core::mem::take(&mut state.code);
            kept = None;
        } else {
            let cwd = crate::cli::check_command::working_directory();
            for (module, text) in &found.modules {
                state.add(&cwd, module, text, Trust::Unsure);
            }
            state.waits_for_the_whole = true;
            waits_for_the_whole = true;
            say_which_road(&format!("{} changed in a way that no other file can see", taken.changed.len()));
        }
    }
    #[cfg(not(unix))]
    let kept: Option<State> = None;
    let is_kept = kept.is_some();
    #[cfg(unix)]
    if let (true, Some(taken)) = (is_kept, &taken) {
        if let Some(before_read) = &before_read {
            taken.read.iter().for_each(|path| before_read(path));
        }
        let _ = bun_core::Output::error_writer().write_all(&taken.said);
        bun_core::Output::flush();
    }
    if !waits_for_the_whole {
        say_which_road(if is_kept { "nothing has changed" } else { "a fresh look" });
    }
    let (handed_over, is_handed_over) = if is_kept { (None, false) } else { (handed_over, is_handed_over) };
    waits_for_the_whole |= handed_over.as_ref().is_some_and(|state| state.waits_for_the_whole);
    *STATE.lock() = Some(State {
        entry_points: paths.clone(),
        is_for_tests,
        ..handed_over.or(kept).unwrap_or_default()
    });
    if !is_handed_over && !is_kept {
        #[cfg(unix)]
        if let Some(start) = &start {
            bun_sema_driver::asked::begin(kept::hash);
            start.note_settings();
        }
        let may_be_kept = on_a_thread_of_its_own(|| look_at_the_whole(&paths, &[], &hinted, is_for_tests, before_read, Audited::Whole));
        #[cfg(unix)]
        if let Some(start) = &start
            && let Some(questions) = bun_sema_driver::asked::end()
            && may_be_kept
            && let Some(tables) = STATE.lock().as_ref().filter(|state| !state.waits_for_the_whole).map(State::to_bytes)
        {
            start.put(&questions, &SEEN_BY_OTHERS.lock(), &SAID.lock(), &tables);
        }
        #[cfg(not(unix))]
        let _ = may_be_kept;
    }
    LAST_ASKED.store(milliseconds(), Ordering::Release);
    bun_ast::audited::set_finish(finish);
    bun_ast::audited::set_source_of_tables(table_for);
    if is_handed_over {
        look_at_what_has_changed();
    }
    if waits_for_the_whole {
        BEGINS_AT_ONCE.store(is_kept, Ordering::Release);
        #[cfg(unix)]
        if let Some(start) = &start {
            start.write_ticket();
        }
        look_at_the_whole_in_the_background();
        #[cfg(unix)]
        for _ in 0..200 {
            if !is_kept || *CHILD.lock() != 0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_micros(500));
        }
    }
    #[cfg(unix)]
    bun_core::before_reload(hand_over);
    !IS_STOPPED.load(Ordering::Acquire)
}

pub(crate) fn is_on() -> bool {
    bun_ast::audited::is_on()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__AOTAudit__waitForTheWhole() -> u32 {
    let is_under_way = || IS_LOOKING_AT_THE_WHOLE.load(Ordering::Acquire) || STATE.lock().as_ref().is_some_and(|state| state.waits_for_the_whole);
    if !is_under_way() {
        return 0;
    }
    let begun = milliseconds();
    while is_under_way() {
        LAST_ASKED.store(0, Ordering::Release);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    say_which_road(&format!("a check failed and waited {} ms for the whole look", milliseconds() - begun));
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
    let acts = u32::from(ACTS.load(Ordering::Acquire)) << 11;
    let of = |id: u32| state.described.get(id as usize).map_or([0, 1, 0], |it| [it.passes | acts, it.least as u32, it.most as u32]);
    let expressions: Vec<[u32; 6]> = (expressions.iter())
        .map(|&[mut start, mut end, id]| {
            while start < end && written.get(start as usize).is_some_and(u8::is_ascii_whitespace) {
                start += 1;
            }
            while start < end && written.get(end as usize - 1).is_some_and(u8::is_ascii_whitespace) {
                end -= 1;
            }
            let [passes, least, most] = of(id);
            [start, end, id, passes, least, most]
        })
        .collect();
    let parameters: Vec<[u32; 6]> = (parameters.iter())
        .map(|&[function, index, id]| {
            let [passes, least, most] = of(id);
            [function, index, id, passes, least, most]
        })
        .collect();
    Some(Box::new(bun_ast::audited::Finished {
        length_of_what_is_written: written.len(),
        expressions,
        parameters,
    }))
}

pub(crate) fn end_file(written: &[u8]) {
    match finish(written) {
        // SAFETY: the two lists are valid for the call, and C++ copies them.
        Some(it) => unsafe { Bun__AOTAudit__setPendingSites(it.length_of_what_is_written, it.expressions.as_ptr(), it.expressions.len(), it.parameters.as_ptr(), it.parameters.len()) },
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

pub(crate) fn want() {
    IS_WANTED.store(true, Ordering::Release);
}

pub(crate) fn act() {
    ACTS.store(true, Ordering::Release);
    bun_ast::audited::keep_directives();
}

pub(crate) fn acts() -> bool {
    ACTS.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__acts() -> bool {
    ACTS.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__isWanted() -> bool {
    IS_WANTED.load(Ordering::Acquire)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__writeRefusedChange(
    kind: *const u8,
    length_of_kind: usize,
    message: &bun_core::String,
    function_name: &bun_core::String,
    source_url: &bun_core::String,
    line: i32,
    column: i32,
) {
    // SAFETY: `kind[..length_of_kind]` is the caller's live buffer.
    let kind = core::str::from_utf8(unsafe { core::slice::from_raw_parts(kind, length_of_kind) }).unwrap_or_default();
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
        (_, Ok("acts")) => ACTS.load(Ordering::Acquire).to_string(),
        (_, Ok("logs")) => (log().0 >= 0).to_string(),
        (Some(state), Ok(key)) => state.shapes.get(key).map_or_else(|| String::from("null"), |text| text.to_string()),
        _ => String::from("null"),
    };
    // SAFETY: `out` is the caller's out-parameter, which holds no string yet.
    unsafe { out.write(bun_core::String::clone_utf8(text.as_bytes())) };
}
