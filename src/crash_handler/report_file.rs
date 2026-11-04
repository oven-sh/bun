//! One file for each crash of an executable that holds compiled code, in a directory that the program names. The program reads
//! it when it next starts. docs/compiler/debugging.mdx lists the members.

#[cfg(unix)]
pub use on_unix::*;

#[cfg(not(unix))]
mod elsewhere {
    pub fn set_directory_of_build(_path: &[u8]) {}
    pub fn take_settings_from_environment() {}
    pub(crate) fn write(_reason: &crate::CrashReason<'_>, _trace: &[u8], _is_main_thread: bool) {}
    pub(crate) fn add_compiled_frames(_frames: &[u8]) {}
}
#[cfg(not(unix))]
pub use elsewhere::*;

#[cfg(unix)]
mod on_unix {
    use core::ffi::{CStr, c_char, c_int};
    use core::fmt::Write as _;
    use core::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, AtomicPtr, Ordering};

    use crate::CrashReason;

    const VERSION: u32 = 1;
    const LONGEST_TAG: usize = 256;
    const LONGEST_PATH: usize = 4096;
    const NO_FRAMES: &[u8] = b"null}\n";

    struct Setting(AtomicPtr<c_char>);

    impl Setting {
        const fn unset() -> Setting {
            Setting(AtomicPtr::new(core::ptr::null_mut()))
        }

        /// Empty text unsets it.
        fn set(&self, text: Vec<u8>) {
            let text = std::ffi::CString::new(text).unwrap_or_default();
            let text = match text.is_empty() {
                true => core::ptr::null_mut(),
                false => text.into_raw(),
            };
            // The one before is never freed: a thread that is crashing may be reading it.
            self.0.store(text, Ordering::Release);
        }

        fn get(&self) -> Option<&'static [u8]> {
            let text = self.0.load(Ordering::Acquire);
            // SAFETY: it came from `CString::into_raw` and is never freed.
            (!text.is_null()).then(|| unsafe { CStr::from_ptr(text) }.to_bytes())
        }
    }

    static DIRECTORY: Setting = Setting::unset();
    static DIRECTORY_OF_BUILD: Setting = Setting::unset();
    static TAG: Setting = Setting::unset();
    static IS_WRITTEN: AtomicBool = AtomicBool::new(false);
    static DESCRIPTOR: AtomicI32 = AtomicI32::new(-1);
    static PLACE_OF_FRAMES: AtomicI64 = AtomicI64::new(0);

    fn holds_compiled_code() -> bool {
        crate::build_id::build_id().is_some()
    }

    fn below_home(path: &[u8], home: Option<&[u8]>) -> Vec<u8> {
        match (path.strip_prefix(b"~/"), home) {
            (Some(rest), Some(home)) => [home, b"/", rest].concat(),
            _ => path.to_vec(),
        }
    }

    /// What the program or its environment asks for. An empty path: what the build asked for.
    fn set_directory(path: &[u8]) {
        if holds_compiled_code() {
            DIRECTORY.set(below_home(path, bun_core::env_var::HOME::get()));
        }
    }

    pub fn set_directory_of_build(path: &[u8]) {
        if holds_compiled_code() {
            DIRECTORY_OF_BUILD.set(below_home(path, bun_core::env_var::HOME::get()));
        }
    }

    /// Text of the program's own, which the file repeats.
    fn set_tag(tag: &[u8]) {
        if holds_compiled_code() {
            TAG.set(tag[..tag.len().min(LONGEST_TAG)].to_vec());
        }
    }

    pub fn take_settings_from_environment() {
        if let Some(path) = bun_core::env_var::BUN_CRASH_REPORT_DIR::get() {
            set_directory(path);
        }
        if let Some(tag) = bun_core::env_var::BUN_CRASH_REPORT_TAG::get() {
            set_tag(tag);
        }
    }

    /// `process.env.BUN_CRASH_REPORT_DIR = path`
    #[unsafe(no_mangle)]
    unsafe extern "C" fn CrashHandler__setReportDirectory(path: *const u8, length: usize) {
        // SAFETY: the caller's bytes are initialized for that length and outlive the call.
        set_directory(unsafe { core::slice::from_raw_parts(path, length) });
    }

    /// `process.env.BUN_CRASH_REPORT_TAG = tag`
    #[unsafe(no_mangle)]
    unsafe extern "C" fn CrashHandler__setReportTag(tag: *const u8, length: usize) {
        // SAFETY: as above.
        set_tag(unsafe { core::slice::from_raw_parts(tag, length) });
    }

    /// JSON, written with nothing but `write`.
    struct Json<'a> {
        sink: &'a mut dyn FnMut(&[u8]),
        buffer: [u8; 512],
        length: usize,
        written: i64,
        has_member: bool,
    }

    impl core::fmt::Write for Json<'_> {
        fn write_str(&mut self, text: &str) -> core::fmt::Result {
            self.bytes(text.as_bytes());
            Ok(())
        }
    }

    impl<'a> Json<'a> {
        fn new(sink: &'a mut dyn FnMut(&[u8])) -> Json<'a> {
            Json {
                sink,
                buffer: [0; 512],
                length: 0,
                written: 0,
                has_member: false,
            }
        }

        fn flush(&mut self) {
            (self.sink)(&self.buffer[..self.length]);
            self.length = 0;
        }

        fn bytes(&mut self, mut bytes: &[u8]) {
            self.written += bytes.len() as i64;
            while !bytes.is_empty() {
                if self.length == self.buffer.len() {
                    self.flush();
                }
                let count = bytes.len().min(self.buffer.len() - self.length);
                self.buffer[self.length..self.length + count].copy_from_slice(&bytes[..count]);
                self.length += count;
                bytes = &bytes[count..];
            }
        }

        fn string(&mut self, text: &[u8]) {
            self.bytes(b"\"");
            for chunk in text.utf8_chunks() {
                for character in chunk.valid().chars() {
                    match character {
                        '"' => self.bytes(b"\\\""),
                        '\\' => self.bytes(b"\\\\"),
                        '\n' => self.bytes(b"\\n"),
                        '\0'..='\x1f' | '\x7f' => {
                            let _ = write!(self, "\\u{:04x}", character as u32);
                        }
                        _ => self.bytes(character.encode_utf8(&mut [0; 4]).as_bytes()),
                    }
                }
                if !chunk.invalid().is_empty() {
                    self.bytes(b"\\ufffd");
                }
            }
            self.bytes(b"\"");
        }

        fn name(&mut self, name: &str) {
            self.bytes(if self.has_member { b",\"" } else { b"{\"" });
            self.has_member = true;
            self.bytes(name.as_bytes());
            self.bytes(b"\":");
        }

        fn text(&mut self, name: &str, value: Option<&[u8]>) {
            self.name(name);
            match value {
                Some(value) => self.string(value),
                None => self.bytes(b"null"),
            }
        }

        fn plain(&mut self, name: &str, value: core::fmt::Arguments<'_>) {
            self.name(name);
            let _ = self.write_fmt(value);
        }

        /// `lines`: as `Bun__AOT__describeAddresses` writes them.
        fn frames(&mut self, lines: &[u8]) {
            self.bytes(b"[");
            let mut is_first = true;
            for line in bun_core::strings::split(lines, b"\n") {
                let line = line.trim_ascii();
                let line = line.strip_prefix(b"at ").unwrap_or(line);
                if line.is_empty() {
                    continue;
                }
                if !core::mem::take(&mut is_first) {
                    self.bytes(b",");
                }
                self.string(line);
            }
            self.bytes(b"]}\n");
        }
    }

    struct Cause<'a> {
        kind: &'static str,
        signal: &'static str,
        address: Option<usize>,
        message: Option<&'a [u8]>,
    }

    fn cause_of<'a>(reason: &CrashReason<'a>) -> Cause<'a> {
        let (kind, signal, address, message) = match *reason {
            CrashReason::Panic(message) => ("panic", "SIGABRT", None, Some(message)),
            CrashReason::Unreachable => ("unreachable", "SIGABRT", None, None),
            CrashReason::SegmentationFault(at) => ("segmentation fault", "SIGSEGV", Some(at), None),
            CrashReason::IllegalInstruction(at) => {
                ("illegal instruction", "SIGILL", Some(at), None)
            }
            CrashReason::BusError(at) => ("bus error", "SIGBUS", Some(at), None),
            CrashReason::FloatingPointError(at) => {
                ("floating point error", "SIGFPE", Some(at), None)
            }
            CrashReason::Abort => ("abort", "SIGABRT", None, None),
            CrashReason::Trap(at) => ("trap", "SIGTRAP", Some(at), None),
            CrashReason::DatatypeMisalignment => ("unaligned access", "SIGABRT", None, None),
            CrashReason::StackOverflow => ("stack overflow", "SIGABRT", None, None),
            CrashReason::ZigError(name) => ("error", "SIGABRT", None, Some(name)),
            CrashReason::OutOfMemory => ("out of memory", "SIGABRT", None, None),
        };
        Cause {
            kind,
            signal,
            address,
            message,
        }
    }

    struct Process<'a> {
        id: i64,
        parent: i64,
        started_at_ms: i64,
        crashed_at_ms: i64,
        tag: Option<&'a [u8]>,
        build_id: Option<[u8; 16]>,
        features: u64,
        is_main_thread: bool,
    }

    /// All but the frames. Answers where they go.
    fn write_members(
        json: &mut Json<'_>,
        process: &Process<'_>,
        reason: &CrashReason<'_>,
        trace: &[u8],
    ) -> i64 {
        use bun_core::Environment;
        let cause = cause_of(reason);
        json.plain("version", format_args!("{VERSION}"));
        json.text("tag", process.tag);
        json.plain("pid", format_args!("{}", process.id));
        json.plain("ppid", format_args!("{}", process.parent));
        json.plain("startedAtMs", format_args!("{}", process.started_at_ms));
        json.plain("crashedAtMs", format_args!("{}", process.crashed_at_ms));
        json.text("bunVersion", Some(Environment::VERSION_STRING.as_bytes()));
        json.text("bunRevision", Some(Environment::GIT_SHA.as_bytes()));
        json.plain("isCanary", format_args!("{}", Environment::IS_CANARY));
        json.text("platform", Some(PLATFORM.as_bytes()));
        json.text("arch", Some(ARCHITECTURE.as_bytes()));
        json.plain("aot", format_args!("{}", process.build_id.is_some()));
        let digits = process
            .build_id
            .map(|id| crate::build_id::write_hexadecimal(&id));
        json.text("buildId", digits.as_ref().map(|digits| &digits[..]));
        let thread: &[u8] = if process.is_main_thread {
            b"main"
        } else {
            b"other"
        };
        json.text("thread", Some(thread));
        json.text("reason", Some(cause.kind.as_bytes()));
        json.text("signal", Some(cause.signal.as_bytes()));
        match cause.address {
            Some(address) => json.plain("address", format_args!("\"{address:#x}\"")),
            None => json.text("address", None),
        }
        json.text("message", cause.message);
        json.plain("featuresWord", format_args!("\"{:#x}\"", process.features));
        json.name("features");
        let names = bun_analytics::PACKED_FEATURES_LIST.iter().enumerate();
        let mut separator: &[u8] = b"[";
        for (_, name) in names.filter(|(bit, _)| process.features >> bit & 1 != 0) {
            json.bytes(core::mem::replace(&mut separator, b","));
            json.string(name.as_bytes());
        }
        let end: &[u8] = if separator == b"[" { b"[]" } else { b"]" };
        json.bytes(end);
        json.text("traceString", Some(trace));
        json.name("compiledFrames");
        let place_of_frames = json.written;
        json.bytes(NO_FRAMES);
        json.flush();
        place_of_frames
    }

    const PLATFORM: &str = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "freebsd"
    };
    const ARCHITECTURE: &str = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };

    fn write_all(descriptor: c_int, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            // SAFETY: `bytes` is initialized for its length.
            let written = unsafe { libc::write(descriptor, bytes.as_ptr().cast(), bytes.len()) };
            match usize::try_from(written) {
                Ok(written) => bytes = &bytes[written..],
                Err(_) if bun_core::ffi::errno() == libc::EINTR => {}
                Err(_) => break,
            }
        }
    }

    struct Path {
        bytes: [u8; LONGEST_PATH],
        length: usize,
    }

    impl core::fmt::Write for Path {
        fn write_str(&mut self, text: &str) -> core::fmt::Result {
            self.push(text.as_bytes()).ok_or(core::fmt::Error)
        }
    }

    impl Path {
        /// Room is kept for the NUL.
        fn push(&mut self, bytes: &[u8]) -> Option<()> {
            let end = self.length + bytes.len();
            self.bytes.get_mut(self.length..end)?.copy_from_slice(bytes);
            (end < LONGEST_PATH).then(|| self.length = end)
        }

        fn as_ptr(&self) -> *const c_char {
            self.bytes.as_ptr().cast()
        }
    }

    fn make_directories(directory: &[u8]) {
        let mut path = Path {
            bytes: [0; LONGEST_PATH],
            length: 0,
        };
        for part in bun_core::strings::split(directory, b"/") {
            if path.push(part).and_then(|()| path.push(b"/")).is_none() {
                return;
            }
            // SAFETY: what follows the bytes pushed so far is zero.
            unsafe { libc::mkdir(path.as_ptr(), 0o700) };
        }
    }

    fn create(directory: &[u8], process_id: i64, now_ms: i64) -> Option<c_int> {
        let mut path = Path {
            bytes: [0; LONGEST_PATH],
            length: 0,
        };
        path.push(directory)?;
        write!(path, "/{process_id}.{now_ms}.crash.json").ok()?;
        let flags =
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW;
        let mode: libc::c_uint = 0o600;
        // SAFETY: what follows the bytes pushed is zero.
        let open = || unsafe { libc::open(path.as_ptr(), flags, mode) };
        let mut descriptor = open();
        if descriptor < 0 && bun_core::ffi::errno() == libc::ENOENT {
            make_directories(directory);
            descriptor = open();
        }
        (descriptor >= 0).then_some(descriptor)
    }

    fn now_ms() -> i64 {
        let mut now = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: `now` is a valid place for the answer.
        unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &raw mut now) };
        now.tv_sec * 1000 + now.tv_nsec / 1_000_000
    }

    /// For a process that is crashing: the first thread that comes writes. It allocates nothing and takes no lock.
    pub(crate) fn write(reason: &CrashReason<'_>, trace: &[u8], is_main_thread: bool) {
        let Some(directory) = DIRECTORY.get().or_else(|| DIRECTORY_OF_BUILD.get()) else {
            return;
        };
        if IS_WRITTEN.swap(true, Ordering::Relaxed) {
            return;
        }
        // SAFETY: neither has preconditions.
        let (id, parent) = unsafe { (libc::getpid(), libc::getppid()) };
        let process = Process {
            id: i64::from(id),
            parent: i64::from(parent),
            started_at_ms: (bun_core::start_time() / 1_000_000) as i64,
            crashed_at_ms: now_ms(),
            tag: TAG.get(),
            build_id: crate::build_id::build_id(),
            features: bun_analytics::packed_features().bits(),
            is_main_thread,
        };
        let Some(descriptor) = create(directory, process.id, process.crashed_at_ms) else {
            return;
        };
        let sink = &mut |bytes: &[u8]| write_all(descriptor, bytes);
        let place = write_members(&mut Json::new(sink), &process, reason, trace);
        PLACE_OF_FRAMES.store(place, Ordering::Relaxed);
        DESCRIPTOR.store(descriptor, Ordering::Release);
    }

    /// The file is whole without them: finding them reads tables that may be what is broken.
    pub(crate) fn add_compiled_frames(frames: &[u8]) {
        let descriptor = DESCRIPTOR.swap(-1, Ordering::Acquire);
        if descriptor < 0 {
            return;
        }
        let place = PLACE_OF_FRAMES.load(Ordering::Relaxed);
        // SAFETY: `descriptor` is the file's.
        if unsafe { libc::lseek(descriptor, place, libc::SEEK_SET) } < 0 {
            return;
        }
        let sink = &mut |bytes: &[u8]| write_all(descriptor, bytes);
        let mut json = Json::new(sink);
        json.frames(frames);
        json.flush();
    }

    #[cfg(test)]
    mod tests {
        use super::{Json, Process, below_home, write_members};
        use crate::CrashReason;

        /// Bun's C++ has these.
        #[unsafe(no_mangle)]
        unsafe extern "C" fn highway_index_of_char(
            text: *const u8,
            length: usize,
            wanted: u8,
        ) -> usize {
            // SAFETY: the caller's bytes are initialized for that length.
            let text = unsafe { core::slice::from_raw_parts(text, length) };
            (0..length).find(|&at| text[at] == wanted).unwrap_or(length)
        }

        #[unsafe(no_mangle)]
        unsafe extern "C" fn highway_memmem(
            text: *const u8,
            length: usize,
            wanted: *const u8,
            wanted_length: usize,
        ) -> *const u8 {
            // SAFETY: as above.
            let (text, wanted) = unsafe {
                (
                    core::slice::from_raw_parts(text, length),
                    core::slice::from_raw_parts(wanted, wanted_length),
                )
            };
            (0..length)
                .find(|&at| text[at..].starts_with(wanted))
                .map_or(core::ptr::null(), |at| text[at..].as_ptr())
        }

        fn written(write: impl FnOnce(&mut Json<'_>)) -> String {
            let mut text = Vec::new();
            let sink = &mut |bytes: &[u8]| text.extend_from_slice(bytes);
            let mut json = Json::new(sink);
            write(&mut json);
            json.flush();
            String::from_utf8(text).unwrap()
        }

        #[test]
        fn home_stands_for_a_leading_tilde() {
            assert_eq!(below_home(b"~/a/b", Some(b"/home/me")), b"/home/me/a/b");
            assert_eq!(below_home(b"~/a/b", None), b"~/a/b");
            assert_eq!(below_home(b"/a/~/b", Some(b"/home/me")), b"/a/~/b");
            assert_eq!(below_home(b"", Some(b"/home/me")), b"");
        }

        #[test]
        fn strings_are_escaped() {
            assert_eq!(
                written(|json| json.string(b"a\"b\\c\nd\te\x1b[0m\xff\xc3\xa9")),
                r#""a\"b\\c\nd\u0009e\u001b[0m\ufffdé""#
            );
            let long = vec![b'x'; 2000];
            assert_eq!(written(|json| json.string(&long)).len(), 2002);
        }

        #[test]
        fn frames_are_one_string_each() {
            assert_eq!(
                written(|json| json.frames(b"    at f (/a.ts:1:2)\n    at /b.ts:3:4\n")),
                "[\"f (/a.ts:1:2)\",\"/b.ts:3:4\"]}\n"
            );
        }

        #[test]
        fn frames_replace_the_null_at_the_end() {
            let process = Process {
                id: 7,
                parent: 3,
                started_at_ms: 1000,
                crashed_at_ms: 2500,
                tag: Some(b"session \"9\""),
                build_id: Some([0xab; 16]),
                features: 0b101,
                is_main_thread: false,
            };
            let mut place = 0;
            let reason = CrashReason::SegmentationFault(0x18);
            let text = written(|json| place = write_members(json, &process, &reason, b"t/1"));
            assert!(text.starts_with(
                r#"{"version":1,"tag":"session \"9\"","pid":7,"ppid":3,"startedAtMs":1000,"crashedAtMs":2500,"bunVersion":""#
            ));
            assert!(text.contains(r#","aot":true,"buildId":"abababababababababababababababab","thread":"other","reason":"segmentation fault","signal":"SIGSEGV","address":"0x18","message":null,"featuresWord":"0x5","features":["Bun.stderr","Bun.stdout"],"traceString":"t/1","compiledFrames":null}"#));
            assert_eq!(&text[place as usize..], "null}\n");
        }

        #[test]
        fn a_panic_has_its_message_and_no_address() {
            let process = Process {
                id: 7,
                parent: 3,
                started_at_ms: 0,
                crashed_at_ms: 0,
                tag: None,
                build_id: None,
                features: 0,
                is_main_thread: true,
            };
            let reason = CrashReason::Panic(b"index out of bounds");
            let text = written(|json| {
                write_members(json, &process, &reason, b"");
            });
            assert!(text.contains(r#""tag":null,"#));
            assert!(text.contains(r#","aot":false,"buildId":null,"thread":"main","reason":"panic","signal":"SIGABRT","address":null,"message":"index out of bounds","featuresWord":"0x0","features":[],"#));
        }
    }
}
