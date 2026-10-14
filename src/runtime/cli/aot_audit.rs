use bun_ast::audited::{AuditedExpression, AuditedFile, AuditedParameter, PrintedAudit};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

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

static STATE: Mutex<Option<State>> = Mutex::new(None);
static IS_LOOKING_AT_THE_WHOLE: AtomicBool = AtomicBool::new(false);
static IS_WANTED: AtomicBool = AtomicBool::new(false);
static LAST_ASKED: AtomicU64 = AtomicU64::new(0);
static LOOKED_AT_ALONE: Mutex<std::collections::BTreeSet<Vec<u8>>> = Mutex::new(std::collections::BTreeSet::new());
static IS_LOOKED_AT: std::sync::Condvar = std::sync::Condvar::new();
#[cfg(unix)]
static CHILD: Mutex<i32> = Mutex::new(0);

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
    let line = format!("[aot] note: {text}\n");
    bun_core::Output::flush();
    unsafe { libc::write(2, line.as_ptr().cast(), line.len()) };
}

fn start_of_next_token(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at..) {
            Some([b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C, ..]) => at += 1,
            Some([0xC2, 0xA0, ..]) => at += 2,
            Some([0xE2, 0x80, 0xA8 | 0xA9, ..]) | Some([0xEF, 0xBB, 0xBF, ..]) => at += 3,
            Some([b'/', b'/', rest @ ..]) => {
                at += 2 + rest.iter().position(|&byte| byte == b'\n' || byte == b'\r').unwrap_or(rest.len());
            }
            Some([b'/', b'*', rest @ ..]) => match rest.windows(2).position(|pair| pair == b"*/") {
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
        let (mut groups, mut parameters) = (HashMap::new(), HashMap::new());
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
        audited.sort();
        let audited: &'static AuditedFile = unsafe { &*bun_core::heap::alloc(audited) };
        self.files.insert(native_path(cwd, &module.path), File { audited, groups, parameters });
        audited
    }

    fn add_without_sites(&mut self, path: &[u8], hash_of_text: u64) -> &'static AuditedFile {
        let audited: &'static AuditedFile = unsafe {
            &*bun_core::heap::alloc(AuditedFile {
                hash_of_text,
                ..Default::default()
            })
        };
        self.files.insert(path.to_vec(), File { audited, groups: HashMap::new(), parameters: HashMap::new() });
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
                audited.sort();
                let audited: &'static AuditedFile = unsafe { &*bun_core::heap::alloc(audited) };
                let groups = theirs.groups.iter().map(|(&key, &id)| (key, renumbered(id))).collect();
                let parameters = theirs.parameters.iter().map(|(&key, &id)| (key, renumbered(id))).collect();
                self.files.insert(path, File { audited, groups, parameters });
            }
            drop(unsafe { bun_core::heap::take(core::ptr::from_ref(theirs.audited).cast_mut()) });
        }
        self.shapes = shapes;
        self.is_renewed();
    }

    fn is_renewed(&mut self) {
        self.generation += 1;
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
        let mut texts: HashMap<u32, Box<str>> = HashMap::new();
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

fn look_at_the_whole(entry_points: &[Vec<u8>], code: &[Vec<u8>], is_for_tests: bool, before_read: Option<bun_sema_driver::host::BeforeRead>, audited: Audited<'_>) {
    let cwd = crate::cli::check_command::working_directory();
    let entries: Vec<EntryPoint> = entry_points.iter().map(|path| EntryPoint::file(path)).collect();
    let (mut code, mut before_read) = (code.to_vec(), before_read);
    let found = loop {
        let mut found = audit_before(&entries, before_read.take(), is_for_tests, audited, &code, None).unwrap_or_default();
        if found.never_visited.is_empty() {
            break found;
        }
        code.append(&mut found.never_visited);
    };
    let mut state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
    let state = state.get_or_insert_with(State::default);
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
}

#[cfg(unix)]
fn look_at_the_whole_in_a_child(entry_points: &[Vec<u8>], code: &[Vec<u8>]) -> Option<State> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::process::CommandExt;
    let asked: Vec<Vec<u8>> = (entry_points.iter().map(|it| [&b"E"[..], &it[..]].concat())).chain(code.iter().map(|it| [&b"C"[..], &it[..]].concat())).collect();
    let fd = unlinked_file_with(&asked.join(&0u8))?;
    let found = (|| {
        let executable = bun_core::self_exe_path().ok()?;
        let mut command = std::process::Command::new(std::ffi::OsStr::from_bytes(executable.as_bytes()));
        for argument in bun_core::argv().into_iter().skip(1).filter(|it| !matches!(*it, b"--watch" | b"--hot")) {
            command.arg(std::ffi::OsStr::from_bytes(argument));
        }
        command.env(std::ffi::OsStr::from_bytes(LOOKS_FOR_ANOTHER.to_bytes()), fd.to_string());
        command.env_remove(std::ffi::OsStr::from_bytes(HANDED_OVER.to_bytes()));
        command.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        unsafe {
            command.pre_exec(|| {
                libc::nice(10);
                Ok(())
            })
        };
        let mut child = command.spawn().ok()?;
        *CHILD.lock().unwrap_or_else(PoisonError::into_inner) = child.id() as i32;
        let mut ended: libc::siginfo_t = unsafe { core::mem::zeroed() };
        while unsafe { libc::waitid(libc::P_PID, child.id() as libc::id_t, &mut ended, libc::WEXITED | libc::WNOWAIT) } == -1 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {}
        {
            let mut running = CHILD.lock().unwrap_or_else(PoisonError::into_inner);
            *running = 0;
            let _ = child.wait();
        }
        State::from_bytes(&read_whole(fd)?)
    })();
    unsafe { libc::close(fd) };
    found
}

#[cfg(unix)]
fn stop_the_child() {
    let mut running = CHILD.lock().unwrap_or_else(PoisonError::into_inner);
    if *running > 0 {
        unsafe { libc::kill(*running, libc::SIGKILL) };
    }
    *running = 0;
}

extern "C" fn stop_the_child_at_exit() {
    stop_the_child();
}

#[cfg(not(unix))]
fn stop_the_child() {}

fn look_at_the_whole_in_the_background() {
    stop_the_child();
    if IS_LOOKING_AT_THE_WHOLE.swap(true, Ordering::AcqRel) {
        return;
    }
    let still_waits = || STATE.lock().unwrap_or_else(PoisonError::into_inner).as_ref().is_some_and(|state| state.waits_for_the_whole);
    let thread = std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        while still_waits() {
            while milliseconds().saturating_sub(LAST_ASKED.load(Ordering::Acquire)) < 300 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let Some((entry_points, code, is_for_tests)) = STATE.lock().unwrap_or_else(PoisonError::into_inner).as_mut().map(|state| {
                state.waits_for_the_whole = false;
                (state.entry_points.clone(), state.code.clone(), state.is_for_tests)
            }) else {
                break;
            };
            #[cfg(unix)]
            {
                let _ = is_for_tests;
                let found = look_at_the_whole_in_a_child(&entry_points, &code);
                if let (Some(found), Some(state)) = (found, STATE.lock().unwrap_or_else(PoisonError::into_inner).as_mut()) {
                    state.merge(found);
                }
            }
            #[cfg(not(unix))]
            look_at_the_whole(&entry_points, &code, is_for_tests, None, Audited::WholeInTheBackground);
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
    let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
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
    let mut looked_at = LOOKED_AT_ALONE.lock().unwrap_or_else(PoisonError::into_inner);
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
        looked_at = IS_LOOKED_AT.wait(looked_at).unwrap_or_else(PoisonError::into_inner);
    }
}

fn look_at_this_alone(path: &[u8], text: &[u8], hash: u64) {
    stop_the_child();
    let (mut entry_points, is_for_tests, is_known_to_the_whole) = {
        let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
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
        if let Some(state) = STATE.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            let mut is_added = false;
            let falls = !is_known_to_the_whole && found.has_errors;
            for (module, text) in found.modules.iter().filter(|(module, _)| !falls && native_path(&cwd, &module.path) == path) {
                let trust = if is_known_to_the_whole || !is_of_a_package { Trust::Unsure } else { Trust::Silent };
                is_added = state.add(&cwd, module, text, trust).hash_of_text == hash;
                if !is_added {
                    note(&format!("{}: nothing is checked in this file: the compiler reads another text of it, as it does where eval is called directly", bstr::BStr::new(&module.path)));
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
        LOOKED_AT_ALONE.lock().unwrap_or_else(PoisonError::into_inner).remove(path);
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
        None => look_at_it_alone(path, text),
    }
}

fn look_at_what_has_changed() {
    let files: Vec<(Vec<u8>, u64)> = {
        let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
        state.as_ref().map_or_else(Vec::new, |state| state.files.iter().map(|(path, file)| (path.clone(), file.audited.hash_of_text)).collect())
    };
    let _ = std::thread::Builder::new().spawn(move || {
        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Audit"));
        for (path, hash) in files {
            let Ok(name) = core::str::from_utf8(&path) else { continue };
            if let Ok(text) = std::fs::read(name)
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
            let (mut groups, mut parameters) = (HashMap::new(), HashMap::new());
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
            audited.sort();
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
    let fd = unsafe { libc::mkstemp(name.as_mut_ptr().cast()) };
    if fd < 0 {
        return None;
    }
    unsafe { libc::unlink(name.as_ptr().cast()) };
    let mut at = 0;
    while at < bytes.len() {
        let written = unsafe { libc::write(fd, bytes[at..].as_ptr().cast(), bytes.len() - at) };
        if written <= 0 {
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
    let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(state) = state.as_ref() else { return };
    let Some(fd) = unlinked_file_with(&state.to_bytes()) else { return };
    bun_core::keep_open_over_reload(fd);
    let number = std::ffi::CString::new(fd.to_string()).expect("digits");
    unsafe { libc::setenv(HANDED_OVER.as_ptr(), number.as_ptr(), 1) };
}

#[cfg(unix)]
fn take_what_was_handed_over() -> Option<State> {
    let number = unsafe { libc::getenv(HANDED_OVER.as_ptr()) };
    if number.is_null() {
        return None;
    }
    let fd: i32 = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok()?.parse().ok()?;
    unsafe { libc::unsetenv(HANDED_OVER.as_ptr()) };
    let bytes = read_whole(fd);
    unsafe { libc::close(fd) };
    State::from_bytes(&bytes?)
}

#[cfg(unix)]
fn read_whole(fd: i32) -> Option<Vec<u8>> {
    let length = unsafe { libc::lseek(fd, 0, libc::SEEK_END) };
    let mut bytes = vec![0u8; usize::try_from(length).unwrap_or(0)];
    let mut at = 0;
    while at < bytes.len() {
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
    let number = unsafe { libc::getenv(LOOKS_FOR_ANOTHER.as_ptr()) };
    if number.is_null() {
        return;
    }
    let Some(fd) = unsafe { core::ffi::CStr::from_ptr(number) }.to_str().ok().and_then(|it| it.parse::<i32>().ok()) else { return };
    let asked = read_whole(fd).unwrap_or_default();
    let of_kind = |kind: u8| -> Vec<Vec<u8>> { asked.split(|&byte| byte == 0).filter(|it| it.first() == Some(&kind)).map(|it| it[1..].to_vec()).collect() };
    let (entry_points, code) = (of_kind(b'E'), of_kind(b'C'));
    on_a_thread_of_its_own(|| look_at_the_whole(&entry_points, &code, is_for_tests, None, Audited::WholeInTheBackground));
    let bytes = STATE.lock().unwrap_or_else(PoisonError::into_inner).as_ref().map_or_else(Vec::new, State::to_bytes);
    let mut at = 0;
    unsafe { libc::ftruncate(fd, 0) };
    while at < bytes.len() {
        let written = unsafe { libc::pwrite(fd, bytes[at..].as_ptr().cast(), bytes.len() - at, at as libc::off_t) };
        if written <= 0 {
            unsafe { libc::_exit(1) };
        }
        at += written as usize;
    }
    unsafe { libc::_exit(0) };
}

#[cfg(not(unix))]
fn take_what_was_handed_over() -> Option<State> {
    None
}

pub(crate) fn prepare(entry_points: &[EntryPoint], before_read: Option<bun_sema_driver::host::BeforeRead>, is_for_tests: bool) {
    #[cfg(unix)]
    look_for_another(is_for_tests);
    let paths: Vec<Vec<u8>> = entry_points.iter().map(|it| it.path.to_vec()).collect();
    let handed_over = take_what_was_handed_over();
    let is_handed_over = handed_over.is_some();
    let waits_for_the_whole = handed_over.as_ref().is_some_and(|state| state.waits_for_the_whole);
    *STATE.lock().unwrap_or_else(PoisonError::into_inner) = Some(State {
        entry_points: paths.clone(),
        is_for_tests,
        ..handed_over.unwrap_or_default()
    });
    if !is_handed_over {
        on_a_thread_of_its_own(|| look_at_the_whole(&paths, &[], is_for_tests, before_read, Audited::Whole));
    }
    LAST_ASKED.store(milliseconds(), Ordering::Release);
    bun_ast::audited::set_finish(finish);
    bun_ast::audited::set_source_of_tables(table_for);
    if is_handed_over {
        look_at_what_has_changed();
    }
    if waits_for_the_whole {
        look_at_the_whole_in_the_background();
    }
    #[cfg(unix)]
    bun_core::before_reload(hand_over);
    bun_core::add_exit_callback(stop_the_child_at_exit);
}

pub(crate) fn is_on() -> bool {
    bun_ast::audited::is_on()
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__installFor(global: *mut bun_jsc::JSGlobalObject) {
    let cwd = crate::cli::check_command::working_directory();
    unsafe { Bun__AOTAudit__install(global, HELPER.as_ptr(), HELPER.len(), cwd.as_ptr(), cwd.len()) };
}

fn finish(written: &[u8]) -> Option<Box<bun_ast::audited::Finished>> {
    bun_ast::audited::current()?;
    let PrintedAudit { expressions, parameters } = bun_ast::audited::take_printed();
    bun_ast::audited::set_current(None);
    let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
    let state = state.as_ref()?;
    let of = |id: u32| state.described.get(id as usize).map_or([0, 1, 0], |it| [it.passes, it.least as u32, it.most as u32]);
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
        Some(it) => unsafe { Bun__AOTAudit__setPendingSites(it.length_of_what_is_written, it.expressions.as_ptr(), it.expressions.len(), it.parameters.as_ptr(), it.parameters.len()) },
        None if is_on() => unsafe { Bun__AOTAudit__setPendingSites(0, core::ptr::null(), 0, core::ptr::null(), 0) },
        None => {}
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__describe(id: u32, out: *mut bun_core::String) {
    let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
    let text = state.as_ref().and_then(|state| state.described.get(id as usize)).map_or("{\"steps\":[]}", |it| &*it.text);
    unsafe { out.write(bun_core::String::clone_utf8(text.as_bytes())) };
}

pub(crate) fn want() {
    IS_WANTED.store(true, Ordering::Release);
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
    let kind = core::str::from_utf8(unsafe { core::slice::from_raw_parts(kind, length_of_kind) }).unwrap_or_default();
    let cwd = crate::cli::check_command::working_directory();
    let path = source_url.to_owned_slice();
    let shown = path.strip_prefix(&cwd[..]).and_then(|rest| rest.strip_prefix(b"/")).unwrap_or(&path);
    let function_name = function_name.to_owned_slice();
    let function_name: &[u8] = if function_name.is_empty() { b"<anonymous>" } else { &function_name };
    let (line, column) = (line.max(0) as usize, column.max(0) as usize);
    let record = format!(
        "[aot] type-error {} {kind} {}:{line}:{column} ({}): {}; would-refuse; count 1\n",
        bun_aot::audit::id_of(shown, line, column, kind, 0),
        bstr::BStr::new(shown),
        bstr::BStr::new(function_name),
        bstr::BStr::new(&message.to_owned_slice()),
    );
    bun_core::Output::flush();
    unsafe { libc::write(2, record.as_ptr().cast(), record.len()) };
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__AOTAudit__describeShape(key: &bun_core::String, out: *mut bun_core::String) {
    let key = key.to_owned_slice();
    let state = STATE.lock().unwrap_or_else(PoisonError::into_inner);
    let text = match (state.as_ref(), core::str::from_utf8(&key)) {
        (Some(state), Ok("")) => state.generation.to_string(),
        (Some(state), Ok(key)) => state.shapes.get(key).map_or_else(|| String::from("null"), |text| text.to_string()),
        _ => String::from("null"),
    };
    unsafe { out.write(bun_core::String::clone_utf8(text.as_bytes())) };
}
