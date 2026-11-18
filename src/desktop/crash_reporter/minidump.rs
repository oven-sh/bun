//! Minidumps with Crashpad's annotations. The process that crashes writes its own: without allocations and locks, and reading
//! what may not be mapped only through system calls.

use core::ffi::c_int;
use core::fmt::{Display, Write as _};
use core::ops::Range;
use core::sync::atomic::{AtomicPtr, Ordering::SeqCst};

use bun_core::debug::{frame_address, strip_return_address_signature};
use bun_core::{RacyCell, heap, strings};
use bun_crash_handler::SignalContext;

use self::disk::{File, Path};
use super::Settings;

pub(super) type Annotations = Vec<(String, String)>;

const CRASHPAD_STREAM: u32 = 0x4350_0001;
const STREAMS: usize = 7;
const DIRECTORY: usize = 32;
const SYSTEM: usize = 120;
const PROCESS: usize = 176;
const THREADS: usize = 200;
const MEMORY: usize = 256;
const EXCEPTION: usize = 280;
const CRASHPAD: usize = 448;
const LINKS: usize = 512;
const LINKED: usize = 528;
const CONTEXT: usize = 560;
const MODULE_SIZE: usize = 108;
const PAGE: usize = 4096;
const MOST_OF_STACK: usize = 512 << 10;

struct Buffers {
    start: [u8; 768 << 10],
    modules: [u8; 4 + 2048 * MODULE_SIZE],
    scratch: [[u8; 2 * PAGE]; 3],
}

pub(super) const LARGEST: usize = size_of::<Buffers>() + MOST_OF_STACK;

pub(super) enum Target<Path> {
    /// Where it is written, where it goes then if it is to be uploaded and if it is not, and what says which.
    Paths([Path; 4]),
    /// In a sandbox. The app does the rest.
    File(bun_sys::File),
}

struct Prepared {
    target: Target<Path>,
    /// Of `Buffers::start`.
    length: usize,
    facts: system::Facts,
}

static BUFFERS: RacyCell<Buffers> = RacyCell::new(Buffers {
    start: [0; _],
    modules: [0; _],
    scratch: [[0; _]; _],
});
/// Whoever swaps one of these out owns it. `BUFFERS` go with the first.
static PREPARED: AtomicPtr<Prepared> = AtomicPtr::new(core::ptr::null_mut());
static PARAMETERS: AtomicPtr<Annotations> = AtomicPtr::new(core::ptr::null_mut());

struct Output<'a> {
    bytes: &'a mut [u8],
    length: usize,
}

impl Output<'_> {
    fn put(&mut self, at: usize, bytes: &[u8]) {
        self.bytes[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn put_words(&mut self, at: usize, words: &[u32]) {
        self.put(at, bun_core::slice_as_bytes(words));
    }

    fn put_address(&mut self, at: usize, address: usize) {
        self.put(at, &(address as u64).to_le_bytes());
    }

    fn reserve(&mut self, size: usize) -> Option<usize> {
        let (at, end) = (self.length, (self.length + size).next_multiple_of(4));
        (end <= self.bytes.len()).then(|| {
            self.length = end;
            at
        })
    }

    fn add_utf8(&mut self, text: &[u8]) -> Option<u32> {
        let at = self.reserve(4 + text.len() + 1)?;
        self.put_words(at, &[text.len() as u32]);
        self.put(at + 4, text);
        Some(at as u32)
    }

    fn add_utf16(&mut self, text: &[u8]) -> Option<u32> {
        let at = self.reserve(4 + 2 * text.len() + 2)?;
        let mut end = at + 4;
        for chunk in text.utf8_chunks() {
            let replacement = (!chunk.invalid().is_empty()).then_some(0xfffd);
            for unit in chunk.valid().encode_utf16().chain(replacement) {
                self.put(end, &unit.to_le_bytes());
                end += 2;
            }
        }
        self.put_words(at, &[(end - at - 4) as u32]);
        Some(at as u32)
    }

    /// Of as many as there is room for. `kind` stands between the name and the value of an object.
    fn add_annotations(
        &mut self,
        location: usize,
        kind: &[u32],
        first: Option<(&[u8], &[u8])>,
        rest: &[(String, String)],
    ) {
        let rest = rest.iter().map(|it| (it.0.as_bytes(), it.1.as_bytes()));
        let all = first.into_iter().chain(rest);
        let size = 8 + 4 * kind.len();
        let Some(table) = self.reserve(4 + size * all.clone().count()) else {
            return;
        };
        let mut end = table + 4;
        for (name, value) in all {
            if let (Some(name), Some(value)) = (self.add_utf8(name), self.add_utf8(value)) {
                self.put_words(end, &[name]);
                self.put_words(end + 4, kind);
                self.put_words(end + size - 4, &[value]);
                end += size;
            }
        }
        self.put_words(table, &[((end - table - 4) / size) as u32]);
        self.put_words(location, &[(end - table) as u32, table as u32]);
    }
}

/// What there is no room for is left out.
impl core::fmt::Write for Output<'_> {
    fn write_str(&mut self, text: &str) -> core::fmt::Result {
        let text = &text[..text.floor_char_boundary(self.bytes.len() - self.length)];
        self.put(self.length, text.as_bytes());
        self.length += text.len();
        Ok(())
    }
}

pub(super) struct About<'a> {
    pub(super) target: Target<String>,
    pub(super) report: [u8; 16],
    pub(super) client: [u8; 16],
    pub(super) system_version: &'a str,
    pub(super) annotations: &'a [(String, String)],
}

/// Once.
pub(super) fn prepare(about: About<'_>) {
    // SAFETY: nothing has been prepared, so nobody else looks at them.
    let bytes = unsafe { &mut (*BUFFERS.get()).start };
    let mut out = Output {
        bytes,
        length: CONTEXT + machine::CONTEXT_SIZE,
    };
    out.put(0, b"MDMP");
    out.put_words(4, &[0xa793, STREAMS as u32, DIRECTORY as u32]);
    let streams: [(u32, usize, usize); STREAMS] = [
        (4, 0, 0),
        (7, 56, SYSTEM),
        (15, 24, PROCESS),
        (3, 52, THREADS),
        (5, 20, MEMORY),
        (6, 168, EXCEPTION),
        (CRASHPAD_STREAM, 64, CRASHPAD),
    ];
    for (index, (kind, size, at)) in streams.into_iter().enumerate() {
        out.put_words(DIRECTORY + 12 * index, &[kind, size as u32, at as u32]);
    }

    let processors = bun_core::get_thread_count().min(255) as u8;
    out.put(
        SYSTEM,
        &[machine::ARCHITECTURE, 0, 0, 0, 0, 0, processors, 1],
    );
    let numbers = strings::split_any(about.system_version.as_bytes(), b".-");
    for (index, number) in numbers.take(3).enumerate() {
        let number = bun_web::headers::digits(number).unwrap_or(0);
        out.put_words(SYSTEM + 8 + 4 * index, &[number as u32]);
    }
    let version = out.add_utf16(about.system_version.as_bytes());
    out.put_words(SYSTEM + 20, &[system::PLATFORM, version.unwrap_or(0)]);
    out.put_words(PROCESS, &[24, 1, crate::process::id()]);

    let context = [machine::CONTEXT_SIZE as u32, CONTEXT as u32];
    out.put_words(THREADS, &[1]);
    out.put_words(THREADS + 44, &context);
    out.put_words(EXCEPTION + 160, &context);
    out.put_words(CRASHPAD, &[1]);
    out.put(CRASHPAD + 4, &about.report);
    out.put(CRASHPAD + 20, &about.client);
    out.add_annotations(CRASHPAD + 36, &[], None, about.annotations);
    out.put_words(CRASHPAD + 44, &[16, LINKS as u32]);
    out.put_words(LINKS, &[1, 0, 28, LINKED as u32]);
    out.put_words(LINKED, &[1]);

    let prepared = Prepared {
        facts: system::facts(matches!(about.target, Target::File(_))),
        target: match about.target {
            Target::Paths(all) => Target::Paths(all.map(|it| disk::path(&it))),
            Target::File(file) => Target::File(file),
        },
        length: out.length,
    };
    PREPARED.store(heap::into_raw(Box::new(prepared)), SeqCst);
    bun_crash_handler::record_crashes_with(record);
}

/// With what a process in a sandbox has not been told.
pub(super) fn complete(
    mut dump: Vec<u8>,
    report: [u8; 16],
    client: [u8; 16],
    annotations: &[(String, String)],
) -> Option<Vec<u8>> {
    let length = dump.len().next_multiple_of(4);
    (length > CONTEXT && dump.starts_with(b"MDMP")).then_some(())?;
    let room = annotations.iter().map(|it| it.0.len() + it.1.len() + 32);
    dump.resize(length + 4 + room.sum::<usize>(), 0);
    let mut out = Output {
        bytes: &mut dump,
        length,
    };
    out.put(CRASHPAD + 4, &report);
    out.put(CRASHPAD + 20, &client);
    out.add_annotations(CRASHPAD + 36, &[], None, annotations);
    Some(dump)
}

pub(super) fn set_parameters(parameters: Annotations) {
    let old = PARAMETERS.swap(heap::into_raw(Box::new(parameters)), SeqCst);
    if !old.is_null() {
        // SAFETY: it comes from the line above, and has been swapped out.
        unsafe { heap::destroy(old) };
    }
}

#[cfg(unix)]
mod disk {
    use core::ffi::c_int;

    pub(super) type Path = bun_core::ZBox;

    pub(super) fn path(path: &str) -> Path {
        Path::from_bytes(path.as_bytes())
    }

    pub(super) fn rename(from: &Path, to: &Path) {
        // SAFETY: terminated strings.
        unsafe { libc::rename(from.as_ptr(), to.as_ptr()) };
    }

    #[derive(Clone, Copy)]
    pub(super) struct File(c_int);

    impl File {
        pub(super) fn open(path: &Path, is_new: bool) -> Option<File> {
            let how = match is_new {
                true => libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
                false => libc::O_RDONLY,
            };
            // SAFETY: a terminated string.
            let file = unsafe { libc::open(path.as_ptr(), how | libc::O_CLOEXEC, 0o600) };
            (file >= 0).then_some(File(file))
        }

        pub(super) fn write_from(self, address: usize, length: usize, offset: usize) -> isize {
            super::system::write_from(self.0, address, length, offset as i64)
        }

        pub(super) fn read_start(self, into: &mut [u8]) -> &[u8] {
            // SAFETY: there is room for as much as is read.
            let read = unsafe { libc::pread(self.0, into.as_mut_ptr().cast(), into.len(), 0) };
            &into[..read.max(0) as usize]
        }

        pub(super) fn of(file: &bun_sys::File) -> File {
            File(file.fd().native())
        }

        pub(super) fn truncate(self, length: usize) {
            // SAFETY: it is open.
            unsafe { libc::ftruncate(self.0, length as i64) };
        }

        pub(super) fn close(self) {
            // SAFETY: as above.
            unsafe { libc::close(self.0) };
        }
    }
}

#[cfg(windows)]
mod disk {
    pub(super) type Path = crate::win32::Wide;

    /// `OVERLAPPED`
    type Offset = [usize; 4];

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileW(
            path: *const u16,
            access: u32,
            sharing: u32,
            security: usize,
            how: u32,
            flags: u32,
            template: usize,
        ) -> isize;
        fn WriteFile(file: isize, from: usize, length: u32, done: &mut u32, at: &mut Offset)
        -> i32;
        fn ReadFile(
            file: isize,
            into: *mut u8,
            length: u32,
            done: &mut u32,
            at: &mut Offset,
        ) -> i32;
        fn SetFileInformationByHandle(file: isize, what: u32, value: &i64, size: u32) -> i32;
        fn CloseHandle(file: isize) -> i32;
        fn MoveFileW(from: *const u16, to: *const u16) -> i32;
    }

    pub(super) fn path(path: &str) -> Path {
        Path::new(path)
    }

    pub(super) fn rename(from: &Path, to: &Path) {
        // SAFETY: terminated strings.
        unsafe { MoveFileW(from.as_ptr(), to.as_ptr()) };
    }

    #[derive(Clone, Copy)]
    pub(super) struct File(isize);

    impl File {
        pub(super) fn open(path: &Path, is_new: bool) -> Option<File> {
            let (access, how) = match is_new {
                true => (0xc000_0000, 1),
                false => (0x8000_0000, 3),
            };
            // SAFETY: a terminated string.
            let file = unsafe { CreateFileW(path.as_ptr(), access, 7, 0, how, 0, 0) };
            (file != -1).then_some(File(file))
        }

        pub(super) fn write_from(self, address: usize, length: usize, offset: usize) -> isize {
            let (mut done, mut at) = (0, [0, 0, offset, 0]);
            // SAFETY: the kernel checks the addresses.
            unsafe { WriteFile(self.0, address, length as u32, &mut done, &mut at) };
            done as isize
        }

        pub(super) fn read_start(self, into: &mut [u8]) -> &[u8] {
            let (mut done, length) = (0, into.len() as u32);
            // SAFETY: there is room for as much as is read.
            unsafe { ReadFile(self.0, into.as_mut_ptr(), length, &mut done, &mut [0; 4]) };
            &into[..done as usize]
        }

        pub(super) fn of(file: &bun_sys::File) -> File {
            File(file.fd().native().expose_provenance() as isize)
        }

        pub(super) fn truncate(self, length: usize) {
            const END_OF_FILE: u32 = 6;
            // SAFETY: it is open, and takes a number of that size.
            unsafe { SetFileInformationByHandle(self.0, END_OF_FILE, &(length as i64), 8) };
        }

        pub(super) fn close(self) {
            // SAFETY: it is open.
            unsafe { CloseHandle(self.0) };
        }
    }
}

impl File {
    /// As far as it can be read.
    fn write_memory(self, start: usize, length: usize, offset: usize) -> usize {
        let mut done = 0;
        while done < length {
            let at = start.wrapping_add(done);
            let part = (length - done).min(PAGE - at % PAGE);
            let written = self.write_from(at, part, offset + done);
            if written <= 0 {
                break;
            }
            done += written as usize;
        }
        done
    }

    fn write(self, bytes: &[u8], offset: usize) -> bool {
        self.write_memory(bytes.as_ptr().expose_provenance(), bytes.len(), offset) == bytes.len()
    }

    /// By way of the file, as far as it can be read.
    fn read_memory(self, start: usize, length: usize, into: &mut [u8]) -> &[u8] {
        let length = self.write_memory(start, length.min(into.len()), 0);
        self.read_start(&mut into[..length])
    }
}

fn word(bytes: &[u8], at: usize) -> Option<u32> {
    bun_core::read_prefix(bytes.get(at..)?)
}

fn address(bytes: &[u8], at: usize) -> Option<usize> {
    bun_core::read_prefix::<u64>(bytes.get(at..)?).map(|it| it as usize)
}

struct Modules<'a> {
    table: Output<'a>,
    rest: Output<'a>,
    /// The checksum and the time of the next one, by which the image is found.
    stamp: [u32; 2],
}

impl Modules<'_> {
    /// `identity` is the record by which its symbols are found.
    fn add(&mut self, base: usize, size: usize, path: &[u8], identity: &[&[u8]]) -> Option<()> {
        let (name, length) = (
            self.rest.add_utf16(path)?,
            identity.iter().map(|it| it.len()).sum(),
        );
        let (record, at) = (self.rest.reserve(length)?, self.table.reserve(MODULE_SIZE)?);
        identity.iter().fold(record, |at, it| {
            self.rest.put(at, it);
            at + it.len()
        });
        self.table.put_address(at, base);
        let size = u32::try_from(size).unwrap_or(u32::MAX);
        let [checksum, time] = self.stamp;
        self.table.put_words(at + 8, &[size, checksum, time, name]);
        self.table
            .put_words(at + 76, &[length as u32, record as u32]);
        Some(())
    }
}

/// Of the data that the program has failed at.
fn without_quotations(message: &[u8]) -> &[u8] {
    let is_end = |it: &[u8; 3]| {
        matches!(
            it,
            [b'f' | b'g', b' ', b'`'] | [_, _, b'\n' | b'"' | b'\'' | b'[']
        )
    };
    &message[..(message.array_windows().position(is_end)).map_or(message.len(), |it| it + 2)]
}

/// Another process of the app may have changed that.
fn uploads(settings: &Path, scratch: &mut [u8]) -> bool {
    File::open(settings, false).is_some_and(|file| {
        let read = Settings::parse(file.read_start(scratch));
        file.close();
        read.is_some_and(|it| it.uploads())
    })
}

#[inline(never)]
fn record(
    signal: c_int,
    fault: Option<usize>,
    context: Option<SignalContext<'_>>,
    reason: &dyn Display,
) {
    // SAFETY: both have been swapped out, and are never freed.
    let (Some(prepared), parameters, buffers) = (unsafe {
        (
            PREPARED.swap(core::ptr::null_mut(), SeqCst).as_ref(),
            PARAMETERS.swap(core::ptr::null_mut(), SeqCst).as_ref(),
            BUFFERS.get(),
        )
    }) else {
        return;
    };
    // SAFETY: they go with `prepared`.
    let buffers = unsafe { &mut *buffers };
    let file = match &prepared.target {
        Target::Paths([unfinished, ..]) => File::open(unfinished, true),
        Target::File(file) => Some(File::of(file)),
    };
    let Some(file) = file else {
        return;
    };
    let mut out = Output {
        bytes: &mut buffers.start,
        length: prepared.length,
    };

    let (registers, flags) = if let Some(context) = context {
        machine::read(context)
    } else {
        let frame = frame_address();
        let saved = file.read_memory(frame, 16, &mut buffers.scratch[0]);
        let mut of_caller = [0; machine::REGISTERS];
        of_caller[machine::FP] = address(saved, 0).unwrap_or(0) as u64;
        let pc = strip_return_address_signature(address(saved, 8).unwrap_or(0));
        of_caller[machine::PC] = pc as u64;
        of_caller[machine::SP] = frame as u64 + 16;
        (of_caller, 0)
    };
    out.put_words(CONTEXT + machine::AT_KIND, &[machine::KIND]);
    out.put_words(CONTEXT + machine::AT_FLAGS, &[flags]);
    out.put(
        CONTEXT + machine::AT_REGISTERS,
        bun_core::slice_as_bytes(&registers),
    );
    let (thread, (code, detail)) = (system::thread(), system::exception(signal));
    out.put_words(THREADS + 4, &[thread]);
    out.put_words(EXCEPTION, &[thread, 0, code, detail]);
    out.put_address(
        EXCEPTION + 24,
        fault.unwrap_or(registers[machine::PC] as usize),
    );
    #[cfg(windows)]
    if let Some(fault) = fault {
        out.put_address(EXCEPTION + 24, registers[machine::PC] as usize);
        out.put_words(EXCEPTION + 32, &[2]);
        out.put_address(EXCEPTION + 48, fault);
    }
    out.put_words(20, &[bun_core::time::timestamp() as u32]);

    let mut message = Output {
        bytes: &mut buffers.scratch[0],
        length: 0,
    };
    let _ = write!(message, "{reason}");
    let message = without_quotations(&message.bytes[..message.length]);
    let (fatal, parameters) = (
        (&b"LOG_FATAL"[..], message),
        parameters.map_or(&[][..], |it| it),
    );
    out.add_annotations(LINKED + 20, &[1], Some(fatal), parameters);

    let table = Output {
        bytes: &mut buffers.modules,
        length: 4,
    };
    let mut modules = Modules {
        table,
        rest: out,
        stamp: [0; 2],
    };
    let (facts, sp) = (&prepared.facts, registers[machine::SP] as usize);
    let mut stack = system::stack(facts, file, sp);
    system::survey(facts, file, &mut buffers.scratch, &mut modules, &mut stack);
    let Modules {
        mut table,
        rest: mut out,
        ..
    } = modules;
    table.put_words(0, &[((table.length - 4) / MODULE_SIZE) as u32]);
    let at_table = out.length;
    out.put_words(DIRECTORY + 4, &[table.length as u32, at_table as u32]);

    let at_stack = (at_table + table.length).next_multiple_of(16);
    // After an overflow it points below the stack.
    let start = sp.saturating_sub(128).max(stack.start);
    let length = stack.end.saturating_sub(start).min(MOST_OF_STACK);
    let size = match start.saturating_sub(sp) <= 64 * PAGE {
        true => file.write_memory(start, length, at_stack),
        false => 0,
    };
    if size > 0 {
        out.put_words(MEMORY, &[1]);
        for at in [MEMORY + 4, THREADS + 28] {
            out.put_address(at, start);
            out.put_words(at + 8, &[size as u32, at_stack as u32]);
        }
    } else {
        out.put_words(DIRECTORY + 4 * 12 + 4, &[4]);
    }

    file.truncate(at_stack + size);
    let is_whole =
        file.write(&table.bytes[..table.length], at_table) && file.write(&out.bytes[..at_table], 0);
    let Target::Paths([unfinished, to_upload, to_keep, settings]) = &prepared.target else {
        return;
    };
    let target = match uploads(settings, &mut buffers.scratch[0]) {
        true => to_upload,
        false => to_keep,
    };
    file.close();
    if is_whole {
        disk::rename(unfinished, target);
    }
}

#[cfg(target_arch = "x86_64")]
mod machine {
    pub(super) const ARCHITECTURE: u8 = 9;
    pub(super) const CONTEXT_SIZE: usize = 1232;
    pub(super) const KIND: u32 = 0x10_0003;
    pub(super) const AT_KIND: usize = 48;
    pub(super) const AT_FLAGS: usize = 68;
    pub(super) const AT_REGISTERS: usize = 120;
    pub(super) const REGISTERS: usize = 17;
    pub(super) const SP: usize = 4;
    pub(super) const FP: usize = 5;
    pub(super) const PC: usize = 16;

    #[cfg(target_os = "linux")]
    pub(super) fn read(context: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        use libc::*;
        let of = |index: c_int| context.mcontext().gregs[index as usize] as u64;
        let order = [
            REG_RAX, REG_RCX, REG_RDX, REG_RBX, REG_RSP, REG_RBP, REG_RSI, REG_RDI, REG_R8, REG_R9,
            REG_R10, REG_R11, REG_R12, REG_R13, REG_R14, REG_R15, REG_RIP,
        ];
        (order.map(of), of(REG_EFL) as u32)
    }

    #[cfg(target_os = "macos")]
    pub(super) fn read(context: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        let it = &context.mcontext().__ss;
        let all = [
            it.__rax, it.__rcx, it.__rdx, it.__rbx, it.__rsp, it.__rbp, it.__rsi, it.__rdi,
            it.__r8, it.__r9, it.__r10, it.__r11, it.__r12, it.__r13, it.__r14, it.__r15, it.__rip,
        ];
        (all, it.__rflags as u32)
    }

    #[cfg(windows)]
    pub(super) fn read(it: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        let all = [
            it.Rax, it.Rcx, it.Rdx, it.Rbx, it.Rsp, it.Rbp, it.Rsi, it.Rdi, it.R8, it.R9, it.R10,
            it.R11, it.R12, it.R13, it.R14, it.R15, it.Rip,
        ];
        (all, it.EFlags)
    }
}

#[cfg(target_arch = "aarch64")]
mod machine {
    pub(super) const ARCHITECTURE: u8 = 12;
    pub(super) const CONTEXT_SIZE: usize = 912;
    pub(super) const KIND: u32 = 0x40_0003;
    pub(super) const AT_KIND: usize = 0;
    pub(super) const AT_FLAGS: usize = 4;
    pub(super) const AT_REGISTERS: usize = 8;
    pub(super) const REGISTERS: usize = 33;
    pub(super) const FP: usize = 29;
    pub(super) const SP: usize = 31;
    pub(super) const PC: usize = 32;

    #[cfg(target_os = "linux")]
    pub(super) fn read(context: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        let (it, mut all) = (context.mcontext(), [0; REGISTERS]);
        all[..SP].copy_from_slice(&it.regs);
        all[SP..].copy_from_slice(&[it.sp, it.pc]);
        (all, it.pstate as u32)
    }

    #[cfg(target_os = "macos")]
    pub(super) fn read(context: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        let (it, mut all) = (&context.mcontext().__ss, [0; REGISTERS]);
        all[..FP].copy_from_slice(&it.__x);
        all[FP..].copy_from_slice(&[it.__fp, it.__lr, it.__sp, it.__pc]);
        (all, it.__cpsr)
    }

    #[cfg(windows)]
    pub(super) fn read(it: super::SignalContext<'_>) -> ([u64; REGISTERS], u32) {
        let mut all = [0; REGISTERS];
        all[..FP].copy_from_slice(&it.X);
        all[FP..].copy_from_slice(&[it.Fp, it.Lr, it.Sp, it.Pc]);
        (all, it.Cpsr)
    }
}

#[cfg(target_os = "linux")]
mod system {
    use super::*;

    pub(super) const PLATFORM: u32 = 0x8201;

    type Images = Vec<(usize, Box<[u8]>)>;

    pub(super) struct Facts {
        /// Where the arguments and the environment begin, above the stack of the first thread.
        top: usize,
        /// In a sandbox, where no more are loaded.
        images: Option<Images>,
    }

    fn images() -> Images {
        unsafe extern "C" fn note(
            info: *mut libc::dl_phdr_info,
            _: usize,
            all: *mut core::ffi::c_void,
        ) -> c_int {
            // SAFETY: what the loader knows about an image, and the list below.
            unsafe {
                let (info, all) = (&*info, &mut *all.cast::<Images>());
                let segments = core::slice::from_raw_parts(info.dlpi_phdr, info.dlpi_phnum.into());
                let name = match core::ffi::CStr::from_ptr(info.dlpi_name).to_bytes() {
                    b"" => crate::process::executable().as_bytes().into(),
                    name => name.into(),
                };
                if let Some(first) = segments.iter().find(|it| it.p_type == libc::PT_LOAD) {
                    all.push((
                        (info.dlpi_addr + first.p_vaddr) as usize & !(PAGE - 1),
                        name,
                    ));
                }
            }
            0
        }
        let mut all = Images::new();
        // SAFETY: it outlives the call.
        unsafe { libc::dl_iterate_phdr(Some(note), (&raw mut all).cast()) };
        all
    }

    pub(super) fn facts(is_in_sandbox: bool) -> Facts {
        Facts {
            // SAFETY: any number will do.
            top: unsafe { libc::getauxval(libc::AT_RANDOM) as usize },
            images: is_in_sandbox.then(images),
        }
    }

    /// Other threads have their descriptors at the end.
    pub(super) fn stack(facts: &Facts, file: File, sp: usize) -> Range<usize> {
        let end = match thread() == crate::process::id() {
            true => facts.top,
            // SAFETY: it reads a register.
            false => unsafe { libc::pthread_self() as usize },
        };
        let mut pages = (sp.saturating_sub(128) & !(PAGE - 1)..end)
            .step_by(PAGE)
            .take(65);
        let is_there = |it: &usize| file.write_memory(*it, 1, 0) == 1;
        facts
            .images
            .as_ref()
            .and_then(|_| pages.find(is_there))
            .unwrap_or(end)..end
    }

    /// Past AddressSanitizer, which objects to its own gaps in the stack.
    pub(super) fn write_from(file: c_int, address: usize, length: usize, offset: i64) -> isize {
        // SAFETY: the kernel checks the addresses.
        unsafe { libc::syscall(libc::SYS_pwrite64, file, address, length, offset) as isize }
    }

    pub(super) fn thread() -> u32 {
        // SAFETY: it takes no arguments.
        unsafe { libc::syscall(libc::SYS_gettid) as u32 }
    }

    pub(super) fn exception(signal: c_int) -> (u32, u32) {
        (signal as u32, 0)
    }

    fn number(digits: &[u8]) -> usize {
        let digits = digits.iter().filter_map(|&it| char::from(it).to_digit(16));
        digits.fold(0, |all, it| all << 4 | it as usize)
    }

    fn build_id(mut notes: &[u8], alignment: usize) -> Option<&[u8]> {
        loop {
            let (name, size) = (word(notes, 0)? as usize, word(notes, 4)? as usize);
            let start = (12 + name).next_multiple_of(alignment);
            if word(notes, 8)? == 3 && notes.get(12..12 + name)? == b"GNU\0" {
                return notes.get(start..start + size);
            }
            notes = notes.get((start + size).next_multiple_of(alignment)..)?;
        }
    }

    fn add(
        file: File,
        base: usize,
        path: &[u8],
        [headers, notes]: [&mut [u8]; 2],
        modules: &mut Modules<'_>,
    ) -> Option<()> {
        let image = file.read_memory(base, PAGE, headers);
        let (start, count) = (address(image, 32)?, word(image, 56)? as usize & 0xffff);
        if !image.starts_with(b"\x7fELF\x02") {
            return None;
        }
        let segments = image.get(start..)?.as_chunks::<56>().0.iter().take(count);
        let segments = segments.map(|it| &it[..]);
        let of_kind = |kind| segments.clone().filter(move |it| word(it, 0) == Some(kind));
        let loaded = of_kind(libc::PT_LOAD);
        let low = address(loaded.clone().next()?, 16)? & !(PAGE - 1);
        let ends = loaded.filter_map(|it| address(it, 16)?.checked_add(address(it, 40)?));
        let size = ends.max()?.checked_sub(low)?;
        for it in of_kind(libc::PT_NOTE) {
            let at = base.wrapping_add(address(it, 16)?).wrapping_sub(low);
            let alignment = if address(it, 48)? == 8 { 8 } else { 4 };
            if let Some(id) = build_id(file.read_memory(at, address(it, 32)?, notes), alignment) {
                return modules.add(base, size, path, &[b"LEpB", id]);
            }
        }
        modules.add(base, size, path, &[])
    }

    pub(super) fn survey(
        facts: &Facts,
        file: File,
        [lines, headers, notes]: &mut [[u8; 2 * PAGE]; 3],
        modules: &mut Modules<'_>,
        stack: &mut Range<usize>,
    ) {
        if let Some(images) = &facts.images {
            for (base, path) in images {
                add(file, *base, path, [headers, notes], modules);
            }
            return;
        }
        // SAFETY: a terminated string.
        let maps = unsafe { libc::open(c"/proc/self/maps".as_ptr(), libc::O_RDONLY) };
        // The last mapping of the beginning of a file.
        let (mut filled, mut beginning) = (0, None);
        loop {
            let read = bun_sys::linux::read(maps, &mut lines[filled..]);
            if read <= 0 {
                break;
            }
            filled += read as usize;
            let mut rest = &lines[..filled];
            while let Some((mut line, after)) = strings::split_once_char(rest, b'\n') {
                rest = after;
                let [range, access, offset, _, inode] = [(); 5].map(|()| {
                    let field;
                    (field, line) = strings::split_once_char(line, b' ').unwrap_or((line, b""));
                    field
                });
                let (path, inode) = (line.trim_ascii_start(), number(inode));
                let (start, end) = strings::split_once_char(range, b'-').unwrap_or_default();
                if (number(start)..number(end)).contains(&stack.end) {
                    stack.start = number(start);
                }
                if number(offset) == 0 && !path.is_empty() {
                    beginning = Some((number(start), inode));
                }
                if strings::contains_char(access, b'x')
                    && let Some((base, _)) = beginning.take_if(|it| it.1 == inode)
                {
                    add(file, base, path, [headers, notes], modules);
                }
            }
            let used = filled - rest.len();
            lines.copy_within(used..filled, 0);
            filled -= used;
        }
        // SAFETY: it is not used any more.
        unsafe { libc::close(maps) };
    }
}

#[cfg(target_os = "macos")]
mod system {
    use bun_sys::macho::{LC_SEGMENT_64, LoadCommandIterator, mach_header_64, segment_command_64};

    use super::*;

    pub(super) const PLATFORM: u32 = 0x8101;

    #[derive(Clone, Copy)]
    pub(super) struct Facts {
        /// Above the stack of the first thread, below the environment.
        arguments: usize,
        /// `dyld_all_image_infos`
        images: usize,
    }

    unsafe extern "C" {
        safe static mach_task_self_: u32;
        fn task_info(task: u32, flavor: u32, info: *mut u32, count: *mut u32) -> c_int;
        safe fn _NSGetArgv() -> &'static usize;
        /// Past AddressSanitizer, which objects to its own gaps in the stack. The kernel checks the addresses.
        #[link_name = "pwrite$NOCANCEL"]
        pub(super) safe fn write_from(
            file: c_int,
            address: usize,
            length: usize,
            offset: i64,
        ) -> isize;
    }

    pub(super) fn facts(_: bool) -> Facts {
        const TASK_DYLD_INFO: u32 = 17;
        let (mut info, mut count) = ([0u32; 5], 5);
        // SAFETY: there is room for `count`.
        unsafe {
            task_info(
                mach_task_self_,
                TASK_DYLD_INFO,
                info.as_mut_ptr(),
                &raw mut count,
            )
        };
        Facts {
            arguments: *_NSGetArgv(),
            images: info[0] as usize | (info[1] as usize) << 32,
        }
    }

    pub(super) fn stack(facts: &Facts, _: File, _: usize) -> Range<usize> {
        // SAFETY: they read fields of this thread's descriptor.
        let (end, size) = unsafe {
            let this = libc::pthread_self();
            (
                libc::pthread_get_stackaddr_np(this).addr(),
                libc::pthread_get_stacksize_np(this),
            )
        };
        let all = end.saturating_sub(size)..end;
        match all.contains(&facts.arguments) {
            true => all.start..facts.arguments,
            false => all,
        }
    }

    pub(super) fn thread() -> u32 {
        let mut id = 0;
        // SAFETY: none stands for this thread.
        unsafe { libc::pthread_threadid_np(0, &raw mut id) };
        id as u32
    }

    /// `EXC_BAD_ACCESS`, `EXC_BAD_INSTRUCTION`, `EXC_ARITHMETIC`, `EXC_BREAKPOINT` or `EXC_CRASH`, and its first code.
    pub(super) fn exception(signal: c_int) -> (u32, u32) {
        match signal {
            libc::SIGSEGV => (1, 1),
            libc::SIGBUS => (1, 2),
            libc::SIGILL => (2, 1),
            libc::SIGFPE => (3, 1),
            libc::SIGTRAP => (6, 1),
            _ => (10, signal as u32),
        }
    }

    fn add(
        file: File,
        base: usize,
        path: &[u8],
        scratch: &mut [u8],
        modules: &mut Modules<'_>,
    ) -> Option<()> {
        const LC_UUID: u32 = 0x1b;
        let image = file.read_memory(base, usize::MAX, scratch);
        let header: mach_header_64 = bun_core::read_prefix(image)?;
        let (start, end) = (u64::MAX, 0);
        let (mut code, mut id) = (start..end, [0u8; 16]);
        for it in LoadCommandIterator::new(header.ncmds, &image[size_of_val(&header)..]) {
            if it.cmd() == LC_UUID {
                id = bun_core::read_prefix(it.data.get(8..)?)?;
            } else if it.cmd() == LC_SEGMENT_64
                && let Some(segment) = it.cast::<segment_command_64>()
                && segment.initprot & libc::PROT_EXEC != 0
            {
                code.start = code.start.min(segment.vmaddr);
                code.end = code.end.max(segment.vmaddr.saturating_add(segment.vmsize));
            }
        }
        for field in [0..4, 4..6, 6..8] {
            id[field].reverse();
        }
        let (size, name) = (
            code.end.saturating_sub(code.start) as usize,
            bun_paths::basename(path),
        );
        modules.add(base, size, path, &[b"RSDS", &id, &[0; 4], name, &[0]])
    }

    pub(super) fn survey(
        facts: &Facts,
        file: File,
        [entry, path, image]: &mut [[u8; 2 * PAGE]; 3],
        modules: &mut Modules<'_>,
        _: &mut Range<usize>,
    ) -> Option<()> {
        let all = file.read_memory(facts.images, 40, entry);
        let (count, array, loader) = (word(all, 4)?, address(all, 8)?, address(all, 32)?);
        for index in 0..count.min(2047) as usize {
            let it = file.read_memory(array.wrapping_add(24 * index), 16, entry);
            let (Some(base), Some(at)) = (address(it, 0), address(it, 8)) else {
                break;
            };
            let path = bun_core::slice_to_nul(file.read_memory(at, 1024, path));
            add(file, base, path, image, modules);
        }
        add(file, loader, b"/usr/lib/dyld", image, modules)
    }
}

#[cfg(windows)]
mod system {
    use super::*;

    pub(super) const PLATFORM: u32 = 2;

    pub(super) struct Facts;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GetCurrentThreadId() -> u32;
        safe fn GetCurrentThreadStackLimits(low: &mut usize, high: &mut usize);
        fn K32EnumProcessModules(
            process: isize,
            modules: *mut u8,
            size: u32,
            needed: &mut u32,
        ) -> i32;
        fn K32GetModuleFileNameExW(
            process: isize,
            module: usize,
            path: *mut u16,
            length: u32,
        ) -> u32;
    }

    const THIS_PROCESS: isize = -1;

    pub(super) fn facts(_: bool) -> Facts {
        Facts
    }

    pub(super) fn stack(_: &Facts, _: File, _: usize) -> Range<usize> {
        let (mut low, mut high) = (0, 0);
        GetCurrentThreadStackLimits(&mut low, &mut high);
        low..high
    }

    pub(super) fn thread() -> u32 {
        GetCurrentThreadId()
    }

    pub(super) fn exception(code: c_int) -> (u32, u32) {
        (code as u32, 0)
    }

    fn add(
        file: File,
        base: usize,
        [path, image]: [&mut [u8]; 2],
        modules: &mut Modules<'_>,
    ) -> Option<()> {
        const CODE_VIEW: u32 = 2;
        let mut units = [0; 520];
        let room = units.len() as u32;
        // SAFETY: the buffer with its length.
        let length =
            unsafe { K32GetModuleFileNameExW(THIS_PROCESS, base, units.as_mut_ptr(), room) };
        let mut path = Output {
            bytes: path,
            length: 0,
        };
        for it in char::decode_utf16(units[..length as usize].iter().copied()) {
            let _ = path.write_char(it.unwrap_or(char::REPLACEMENT_CHARACTER));
        }
        let path = &path.bytes[..path.length];
        let headers = file.read_memory(base, PAGE, image);
        let headers = headers.get(word(headers, 60)? as usize..)?;
        let [time, size, checksum, debug, debug_size] =
            [8, 80, 88, 184, 188].map(|at| word(headers, at));
        modules.stamp = [checksum?, time?];
        let entries = file.read_memory(base + debug? as usize, debug_size? as usize, image);
        let mut entries = entries.as_chunks::<28>().0.iter();
        let found = entries.find(|it| word(*it, 12) == Some(CODE_VIEW));
        let (length, at) =
            (found.and_then(|it| word(it, 16).zip(word(it, 20)))).unwrap_or_default();
        let identity = file.read_memory(base + at as usize, length as usize, image);
        modules.add(base, size? as usize, path, &[identity])
    }

    pub(super) fn survey(
        _: &Facts,
        file: File,
        [all, path, image]: &mut [[u8; 2 * PAGE]; 3],
        modules: &mut Modules<'_>,
        _: &mut Range<usize>,
    ) {
        let (mut needed, room) = (0, all.len() as u32);
        // SAFETY: the buffer with its size. It takes no lock.
        unsafe { K32EnumProcessModules(THIS_PROCESS, all.as_mut_ptr(), room, &mut needed) };
        for base in all[..needed.min(room) as usize].as_chunks().0 {
            add(file, usize::from_le_bytes(*base), [path, image], modules);
        }
    }
}

fn located<'a>(
    dump: &'a [u8],
    location: &[u8],
    at: usize,
) -> Option<impl Iterator<Item = &'a [u8]> + use<'a>> {
    let (size, start) = (
        word(location, at)? as usize,
        word(location, at + 4)? as usize,
    );
    let table = dump.get(start..start.checked_add(size)?)?;
    let size = (size.checked_sub(4)?).checked_div(word(table, 0)? as usize)?;
    (size >= 8).then(|| table[4..].chunks_exact(size))
}

/// The client and the annotations that are text, also of a dump that Crashpad has written.
pub(super) fn annotations(dump: &[u8]) -> Option<([u8; 16], Vec<(&[u8], &[u8])>)> {
    let streams = dump.get(word(dump, 12)? as usize..)?.as_chunks::<12>().0;
    let mut streams = streams.iter().take(word(dump, 8)? as usize);
    let stream = streams.find(|it| word(*it, 0) == Some(CRASHPAD_STREAM))?;
    let info = dump.get(word(stream, 8)? as usize..)?;
    const MOST: usize = 256;
    let length = |at: u32| Some(super::LONGEST_VALUE.min(word(dump, at as usize)? as usize));
    let text = |at: u32| dump.get(at as usize + 4..)?.get(..length(at)?);
    let pair = |it: &[u8]| Some((text(word(it, 0)?)?, text(word(it, it.len() - 4)?)?));
    let pairs = |location, at| located(dump, location, at).into_iter().flatten();
    let mut all: Vec<_> = pairs(info, 36).take(MOST).filter_map(pair).collect();
    for link in pairs(info, 44).take(MOST) {
        let linked = dump.get(word(link, 8)? as usize..)?;
        let objects = pairs(linked, 20).filter(|it| word(it, 4) == Some(1));
        let room = 2 * MOST - all.len();
        all.extend(pairs(linked, 12).chain(objects).take(room).filter_map(pair));
    }
    Some((bun_core::read_prefix(info.get(20..)?)?, all))
}
