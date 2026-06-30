//! Process tests in three tiers: pure KATs over the quoter / env-block /
//! path classifier (no children), filesystem-backed search-matrix tests, and
//! real-child suites driving cmd.exe / ping.exe through the loop with stdio
//! composed from `pipe::create_pair`. The quoter's end-to-end oracle is
//! `CommandLineToArgvW` — the same oracle libuv's argument_escaping test
//! pins. // quirk: PROC-01

use core::ffi::c_void;
use core::ptr;

use bun_windows_sys::kernel32::{RemoveDirectoryW, WriteFile};
use bun_windows_sys::{
    CREATE_ALWAYS, CommandLineToArgvW, CreateDirectoryW, DeleteFileW, GENERIC_WRITE,
    GetCurrentProcessId, IsProcessInJob, SetEnvironmentVariableW,
};

use super::*;
use crate::event_loop::Loop;
use crate::pipe::{PairOptions, PipeHandle, create_pair};
use crate::test_sync::serial;

// APIs needed only by tests (kept out of the production extern surface).
#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(hMem: *mut c_void) -> *mut c_void;
}

// ───────────────────────── helpers ─────────────────────────

fn w(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_w(v: &[u16]) -> String {
    let v = v.strip_suffix(&[0]).unwrap_or(v);
    String::from_utf16_lossy(v)
}

/// Convert through the production WTF-8 encoder for assertions.
fn to_utf16(s: &[u8]) -> Vec<u16> {
    let mut out = Vec::new();
    wtf8_to_utf16(s, &mut out).expect("valid WTF-8");
    out
}

/// cmd.exe via %ComSpec% as WTF-8 bytes (full path, so the literal-with-ext
/// search arm resolves it).
fn comspec() -> Vec<u8> {
    let v = get_env_var(&w("ComSpec")).expect("ComSpec is always set");
    String::from_utf16(&v)
        .expect("ComSpec is unicode")
        .into_bytes()
}

/// ASCII-ish bytes → String for assertions (child output is ASCII here;
/// Latin-1 mapping keeps it lossless without the disallowed lossy helper).
fn ascii(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

// Raw Win32 filesystem helpers: this crate is tier-0 (no bun_sys), so the
// fixtures use the same primitives production code does.

fn mkdir(path: &str) {
    let z = w(&format!("{path}\0"));
    // SAFETY: NUL-terminated name; null security attributes.
    let ok = unsafe { CreateDirectoryW(z.as_ptr(), ptr::null_mut()) };
    assert!(
        ok != 0 || Win32Error::get() == Win32Error::ALREADY_EXISTS,
        "mkdir {path}: {:?}",
        Win32Error::get()
    );
}

fn write_file(path: &str, bytes: &[u8]) {
    let z = w(&format!("{path}\0"));
    // SAFETY: NUL-terminated name; no other pointers.
    let h = unsafe {
        CreateFileW(
            z.as_ptr(),
            GENERIC_WRITE,
            0,
            ptr::null_mut(),
            CREATE_ALWAYS,
            0,
            ptr::null_mut(),
        )
    };
    assert_ne!(h, INVALID_HANDLE_VALUE, "create {path}");
    let mut written: DWORD = 0;
    // SAFETY: live handle; bytes is a live slice; valid out-pointer.
    let ok = unsafe {
        WriteFile(
            h,
            bytes.as_ptr(),
            bytes.len() as DWORD,
            &raw mut written,
            ptr::null_mut(),
        )
    };
    assert!(ok != 0 && written as usize == bytes.len(), "write {path}");
    // SAFETY: opened above.
    unsafe { CloseHandle(h) };
}

fn rm_file(path: &str) {
    let z = w(&format!("{path}\0"));
    // SAFETY: NUL-terminated name. Best-effort cleanup.
    unsafe { DeleteFileW(z.as_ptr()) };
}

fn rmdir(path: &str) {
    let z = w(&format!("{path}\0"));
    // SAFETY: NUL-terminated name. Best-effort cleanup.
    unsafe { RemoveDirectoryW(z.as_ptr()) };
}

/// Fresh scratch directory under %TEMP% (std path math is fine in tests;
/// only std::fs I/O is disallowed).
fn scratch_dir(tag: &str) -> std::path::PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let d = std::env::temp_dir().join(format!("bun-iocp-proc-{}-{tag}-{n}", GetCurrentProcessId()));
    mkdir(d.to_str().expect("ascii temp"));
    d
}

struct ExitCtx {
    fired: bool,
    code: i64,
    signal: i32,
    closes: u32,
}

impl ExitCtx {
    fn new() -> Box<ExitCtx> {
        Box::new(ExitCtx {
            fired: false,
            code: -1,
            signal: -1,
            closes: 0,
        })
    }
}

unsafe fn on_exit(_l: &mut Loop, data: *mut c_void, code: i64, signal: i32) {
    // SAFETY: data is the test's live ExitCtx.
    unsafe {
        let ctx = &mut *data.cast::<ExitCtx>();
        assert!(!ctx.fired, "exit callback fired twice");
        ctx.fired = true;
        ctx.code = code;
        ctx.signal = signal;
    }
}

unsafe fn on_close(_l: &mut Loop, data: *mut c_void) {
    // SAFETY: data is the test's live ExitCtx.
    unsafe { (*data.cast::<ExitCtx>()).closes += 1 };
}

struct IoCtx {
    received: Vec<u8>,
    eof: bool,
    read_err: Win32Error,
    wrote: bool,
    write_err: Win32Error,
    closes: u32,
}

impl IoCtx {
    fn new() -> Box<IoCtx> {
        Box::new(IoCtx {
            received: Vec::new(),
            eof: false,
            read_err: Win32Error::SUCCESS,
            wrote: false,
            write_err: Win32Error::SUCCESS,
            closes: 0,
        })
    }
}

unsafe fn on_pipe_read(_l: &mut Loop, data: *mut c_void, buf: *mut u8, n: usize, err: Win32Error) {
    // SAFETY: data is the test's live IoCtx; buf/n are the engine's delivery.
    unsafe {
        let ctx = &mut *data.cast::<IoCtx>();
        if err == Win32Error::SUCCESS {
            ctx.received
                .extend_from_slice(core::slice::from_raw_parts(buf, n));
        } else {
            ctx.read_err = err;
            ctx.eof = true;
        }
    }
}

unsafe fn on_pipe_write(_l: &mut Loop, data: *mut c_void, _n: usize, err: Win32Error) {
    // SAFETY: data is the test's live IoCtx.
    unsafe {
        let ctx = &mut *data.cast::<IoCtx>();
        ctx.wrote = true;
        ctx.write_err = err;
    }
}

unsafe fn on_pipe_close(_l: &mut Loop, data: *mut c_void) {
    // SAFETY: data is the test's live IoCtx.
    unsafe { (*data.cast::<IoCtx>()).closes += 1 };
}

/// Tick until `pred` or panic at `deadline_ms`.
fn tick_until(loop_: &mut Loop, deadline_ms: u64, what: &str, mut pred: impl FnMut() -> bool) {
    let deadline = loop_.now_ms() + deadline_ms;
    while !pred() {
        assert!(loop_.now_ms() < deadline, "timed out waiting for {what}");
        loop_.tick(Some(25));
    }
}

/// Spawn through the engine with exit wired to `ctx`.
///
/// # Safety
/// Standard spawn contract; `ctx` must outlive the handle.
unsafe fn spawn_with(
    loop_: &mut Loop,
    options: &ProcessOptions<'_>,
    ctx: &mut ExitCtx,
) -> Result<Box<ProcessHandle>, Win32Error> {
    let lp: *mut Loop = loop_;
    // SAFETY: forwarded fn contract.
    unsafe {
        ProcessHandle::spawn(
            lp,
            options,
            Some(on_exit),
            ptr::from_mut(ctx).cast::<c_void>(),
        )
    }
}

fn close_and_drain(loop_: &mut Loop, h: &mut ProcessHandle, ctx: &mut ExitCtx) {
    let before = ctx.closes;
    h.close(Some(on_close), ptr::from_mut(ctx).cast::<c_void>());
    let ctx_ptr: *const ExitCtx = ptr::from_ref(ctx);
    // SAFETY: ctx outlives the drain; read-only progress probe.
    tick_until(loop_, 10_000, "process close", || unsafe {
        (*ctx_ptr).closes > before
    });
}

// ───────────────────────── pure KATs: WTF-8 ─────────────────────────

/// // quirk: PROC-06
#[test]
fn wtf8_to_utf16_kats() {
    let ok = |src: &[u8]| {
        let mut out = Vec::new();
        wtf8_to_utf16(src, &mut out).expect("valid");
        out
    };
    assert_eq!(ok(b"abc"), [0x61, 0x62, 0x63]);
    assert_eq!(ok(&[0xC2, 0x80]), [0x80]); // 2-byte boundary
    assert_eq!(ok("é".as_bytes()), [0xE9]);
    assert_eq!(ok("€".as_bytes()), [0x20AC]);
    assert_eq!(ok("𐍈".as_bytes()), [0xD800, 0xDF48]); // astral → pair
    // Lone surrogates round-trip — that is the WTF-8 contract.
    assert_eq!(ok(&[0xED, 0xA0, 0x80]), [0xD800]);
    assert_eq!(ok(&[0xED, 0xB2, 0x80]), [0xDC80]);

    let err = |src: &[u8]| {
        let mut out = Vec::new();
        wtf8_to_utf16(src, &mut out).expect_err("invalid")
    };
    assert_eq!(err(&[0xC0, 0x80]), Win32Error::INVALID_PARAMETER); // overlong
    assert_eq!(err(&[0x80]), Win32Error::INVALID_PARAMETER); // bare continuation
    assert_eq!(err(&[0xE2, 0x82]), Win32Error::INVALID_PARAMETER); // truncated
    assert_eq!(
        err(&[0xF5, 0x80, 0x80, 0x80]),
        Win32Error::INVALID_PARAMETER
    );
    assert_eq!(err(&[0x61, 0x00, 0x62]), Win32Error::INVALID_PARAMETER); // NUL
}

// ───────────────────────── pure KATs: quoting ─────────────────────────

fn quoted(arg: &str) -> String {
    let mut out = Vec::new();
    quote_cmd_arg(&w(arg), &mut out);
    from_w(&out)
}

/// The documented expected-I/O table plus the three entry paths.
/// // quirk: PROC-01, PROC-02, PROC-03
#[test]
fn quote_cmd_arg_documented_kats() {
    // Slow-path table from process.c:480-496.
    assert_eq!(quoted("hello\"world"), r#""hello\"world""#);
    assert_eq!(quoted("hello\"\"world"), r#""hello\"\"world""#);
    assert_eq!(quoted("hello\\world"), r"hello\world"); // no trigger chars
    assert_eq!(quoted("hello\\\\world"), r"hello\\world");
    assert_eq!(quoted("hello\\\"world"), r#""hello\\\"world""#);
    assert_eq!(quoted("hello\\\\\"world"), r#""hello\\\\\"world""#);
    assert_eq!(quoted("hello world\\"), r#""hello world\\""#);
    // Empty argument must materialize. // quirk: PROC-02
    assert_eq!(quoted(""), r#""""#);
    // Fast path 1: no space/tab/quote → verbatim, even with cmd-special
    // chars — `&|^%` are NOT triggers. // quirk: PROC-03
    assert_eq!(quoted("&|^%!()<>"), "&|^%!()<>");
    assert_eq!(quoted(r"C:\dir\file"), r"C:\dir\file");
    // Fast path 2: spaces but no quote/backslash → plain wrap.
    assert_eq!(quoted("hello world"), r#""hello world""#);
    assert_eq!(quoted("a\tb"), "\"a\tb\"");
}

fn oracle_parse(cmdline: &[u16]) -> Vec<String> {
    let mut z = cmdline.to_vec();
    if z.last() != Some(&0) {
        z.push(0);
    }
    let mut argc: core::ffi::c_int = 0;
    // SAFETY: z is NUL-terminated; argc is a valid out-pointer.
    let argv = unsafe { CommandLineToArgvW(z.as_ptr(), &raw mut argc) };
    assert!(!argv.is_null(), "CommandLineToArgvW failed");
    let mut out = Vec::new();
    for i in 0..argc as usize {
        // SAFETY: argv has argc valid NUL-terminated entries.
        unsafe {
            let p = *argv.add(i);
            let mut len = 0;
            while *p.add(len) != 0 {
                len += 1;
            }
            out.push(String::from_utf16_lossy(core::slice::from_raw_parts(
                p, len,
            )));
        }
    }
    // SAFETY: argv came from CommandLineToArgvW (LocalAlloc-backed).
    unsafe { LocalFree(argv.cast::<c_void>()) };
    out
}

/// Round-trip every rule class through the REAL Windows parser — the same
/// oracle libuv pins (test-spawn.c argument_escaping). // quirk: PROC-01,
/// PROC-02, PROC-03
#[test]
fn command_line_round_trips_through_commandlinetoargvw() {
    let corpus: &[&str] = &[
        "plain",
        "hello world",
        "hello\twheel",
        "hello\"world",
        "hello\"\"world",
        "hello\\world",
        "hello\\\\world",
        "hello\\\"world",
        "hello\\\\\"world",
        "hello world\\",
        "trailing\\\\",
        "",
        " ",
        "\"",
        "\\",
        "\\\"",
        "mix \\\" end\\",
        "&|^%!",
        "a=b c",
        "ünïcödé ok",
    ];
    // Dummy argv[0]: the oracle parses the first token with program-name
    // rules, not CRT arg rules.
    let mut args: Vec<&[u8]> = vec![&b"X"[..]];
    let owned: Vec<Vec<u8>> = corpus.iter().map(|s| s.as_bytes().to_vec()).collect();
    for o in &owned {
        args.push(o);
    }
    let cmdline = make_command_line(&args, false).expect("encodes");
    let parsed = oracle_parse(&cmdline);
    assert_eq!(
        parsed.len(),
        corpus.len() + 1,
        "cmdline: {}",
        from_w(&cmdline)
    );
    for (i, expect) in corpus.iter().enumerate() {
        assert_eq!(
            parsed[i + 1],
            *expect,
            "arg {i} corrupted; cmdline: {}",
            from_w(&cmdline)
        );
    }
}

/// // quirk: PROC-04
#[test]
fn verbatim_join_is_byte_exact() {
    let cmdline =
        make_command_line(&[b"cmd", b"/c", b"echo has spaces", b"a\"b\\"], true).expect("encodes");
    assert_eq!(from_w(&cmdline), "cmd /c echo has spaces a\"b\\");
}

// ───────────────────────── pure KATs: env block ─────────────────────────

fn block_entries(block: &[u16]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < block.len() && block[i] != 0 {
        let len = block[i..].iter().position(|&c| c == 0).expect("terminated");
        out.push(String::from_utf16_lossy(&block[i..i + len]));
        i += len + 1;
    }
    assert_eq!(block.get(i), Some(&0), "double-NUL terminator");
    out
}

/// Sort + last-wins dedup + hidden passthrough + drop-no-'=' + required-var
/// merge (present / injected / absent-in-parent), hermetic via the
/// injectable parent fetch. // quirk: PROC-08, PROC-09, PROC-10, PROC-11,
/// PROC-12
#[test]
fn env_block_sort_dedup_hidden_and_required() {
    let fetch = |name: &[u16]| -> Option<Vec<u16>> {
        match String::from_utf16_lossy(name).as_str() {
            "SYSTEMROOT" => Some(w(r"C:\FakeRoot")),
            _ => None, // every other required var is absent in the "parent"
        }
    };
    let entries: &[&[u8]] = &[
        b"b=2",
        b"a=1",
        b"A=3",          // duplicate of a (case-insensitive): last one wins
        b"=C:=C:\\hid",  // hidden per-drive entries pass through, sorted first
        b"=D:=D:\\hid2", // ...and never dedup against each other
        b"INVALID",      // no '=' → dropped
        b"SYSTEM=x",     // substring-name siblings of the injected var
        b"SYSTEMROOTED=y",
        b"Path=C:\\UserPath", // satisfies required PATH (case-insensitive)
    ];
    let block = make_env_block_with(entries, fetch).expect("builds");
    assert_eq!(
        block_entries(&block),
        [
            "=C:=C:\\hid",
            "=D:=D:\\hid2",
            "A=3",
            "b=2",
            "Path=C:\\UserPath",
            "SYSTEM=x",
            "SYSTEMROOT=C:\\FakeRoot",
            "SYSTEMROOTED=y",
        ]
    );

    // The child's PATH is found in the BUILT block, matching `Path=`
    // case-insensitively (the real-world spelling). // quirk: PROC-14
    assert_eq!(find_path_in_block(&block), Some(w(r"C:\UserPath")));

    // Empty caller env: required vars only; with an empty parent too, the
    // accepted single-NUL block. // quirk: PROC-07
    let empty = make_env_block_with(&[], |_| None).expect("builds");
    assert_eq!(empty, [0]);
    assert_eq!(find_path_in_block(&empty), None);
}

/// Pairwise CompareStringOrdinal(ignoreCase) ordering over the built block —
/// libuv's environment_creation pin — using a corpus where case-SENSITIVE
/// ordinal order would differ. // quirk: PROC-10
#[test]
fn env_block_pairwise_ordinal_order() {
    let entries: &[&[u8]] = &[b"zz=1", b"B=2", b"a=3", b"Zebra=4", b"yak=5"];
    let block = make_env_block_with(entries, |_| None).expect("builds");
    let names: Vec<Vec<u16>> = block_entries(&block)
        .iter()
        .map(|e| w(e.split('=').next().expect("has name")))
        .collect();
    assert!(names.len() >= 5);
    for pair in names.windows(2) {
        // SAFETY: live slices with exact lengths.
        let r = unsafe {
            CompareStringOrdinal(
                pair[0].as_ptr(),
                pair[0].len() as core::ffi::c_int,
                pair[1].as_ptr(),
                pair[1].len() as core::ffi::c_int,
                TRUE,
            )
        };
        assert!(
            r < CSTR_EQUAL,
            "block not strictly ordered: {:?} !< {:?}",
            from_w(&pair[0]),
            from_w(&pair[1])
        );
    }
    // 'a' must order before 'B' (ordinal-uppercase table), the opposite of
    // a case-sensitive ordinal compare.
    assert_eq!(block_entries(&block)[0], "a=3");
}

// ───────────────────────── pure KATs: path shapes ─────────────────────────

/// // quirk: PROC-21, PROC-16
#[test]
fn join_candidate_classifies_all_path_shapes() {
    let j = |dir: &str, name: &str, ext: &str, cwd: &str| {
        from_w(&join_candidate(&w(dir), &w(name), &w(ext), &w(cwd)))
    };
    let cwd = r"C:\cw";
    // UNC (both slash spellings) ignores cwd.
    assert_eq!(j(r"\\srv\share", "x", "exe", cwd), r"\\srv\share\x.exe");
    assert_eq!(j("//srv/share", "x", "exe", cwd), r"//srv/share\x.exe");
    // Rooted-no-drive keeps only the cwd drive prefix.
    assert_eq!(j(r"\dir", "x", "exe", cwd), r"C:\dir\x.exe");
    // Drive-relative: same drive substitutes the full cwd...
    assert_eq!(j("c:sub", "x", "exe", cwd), r"C:\cw\sub\x.exe");
    // ...different drive uses the entry as-is.
    assert_eq!(j("D:sub", "x", "exe", cwd), r"D:sub\x.exe");
    // Drive-absolute ignores cwd.
    assert_eq!(j(r"D:\bin", "x", "exe", cwd), r"D:\bin\x.exe");
    // Relative appends to cwd; trailing separator never doubles.
    assert_eq!(j("rel", "x", "exe", cwd), r"C:\cw\rel\x.exe");
    assert_eq!(j(r"rel\", "x", "exe", cwd), r"C:\cw\rel\x.exe");
    assert_eq!(j("", "x", "exe", cwd), r"C:\cw\x.exe");
    // Literal try: no extension, no dot.
    assert_eq!(j("rel", "x", "", cwd), r"C:\cw\rel\x");
    // A name already ending in '.' gets no second dot. // quirk: PROC-16
    assert_eq!(j("", "x.", "exe", cwd), r"C:\cw\x.exe");
}

// ───────────────────────── pure KATs: hostile blob ─────────────────────────

/// // quirk: PROC-35
#[test]
fn stdio_verify_rejects_hostile_blobs() {
    assert!(!stdio_verify(ptr::null(), 64));
    let blob3 = [3u8, 0, 0, 0];
    assert!(!stdio_verify(blob3.as_ptr(), 3)); // smaller than the count header
    // count = 257 > 256 → rejected regardless of size.
    let mut big = vec![0u8; 4 + 257 + 257 * size_of::<HANDLE>()];
    big[..4].copy_from_slice(&257u32.to_ne_bytes());
    assert!(!stdio_verify(big.as_ptr(), big.len() as WORD));
    // count = 4 but buffer too small for 4 slots.
    let mut short = [0u8; 16];
    short[..4].copy_from_slice(&4u32.to_ne_bytes());
    assert!(!stdio_verify(short.as_ptr(), short.len() as WORD));
    // Valid shape (also the inbound 256 tolerance boundary).
    let cs = ChildStdio::new(3);
    assert!(stdio_verify(cs.blob.as_ptr(), cs.size()));
    let mut max = vec![0u8; 4 + 256 + 256 * size_of::<HANDLE>()];
    max[..4].copy_from_slice(&256u32.to_ne_bytes());
    assert!(stdio_verify(max.as_ptr(), max.len() as WORD));
}

// ───────────────────────── pure KATs: flags ─────────────────────────

/// // quirk: PROC-39, PROC-40, PROC-41
#[test]
fn creation_flags_matrix() {
    const CREATE_BREAKAWAY_FROM_JOB: DWORD = 0x0100_0000;
    let cases: &[(u32, bool)] = &[
        (0, false),
        (PROCESS_HIDE, false),
        (PROCESS_HIDE, true),
        (PROCESS_HIDE_CONSOLE, false),
        (PROCESS_HIDE_CONSOLE, true),
        (PROCESS_HIDE_GUI, false),
        (PROCESS_DETACHED, false),
        (PROCESS_DETACHED | PROCESS_HIDE, false),
    ];
    for &(flags, any_inherit) in cases {
        let (pf, show) = creation_flags(flags, any_inherit);
        assert_ne!(pf & CREATE_UNICODE_ENVIRONMENT, 0, "flags={flags:#x}");
        assert_eq!(pf & CREATE_BREAKAWAY_FROM_JOB, 0, "never breakaway");
        let wants_no_window = flags & (PROCESS_HIDE | PROCESS_HIDE_CONSOLE) != 0 && !any_inherit;
        assert_eq!(
            pf & CREATE_NO_WINDOW != 0,
            wants_no_window,
            "flags={flags:#x} inherit={any_inherit}"
        );
        let wants_hide_gui = flags & (PROCESS_HIDE | PROCESS_HIDE_GUI) != 0;
        assert_eq!(
            show,
            if wants_hide_gui {
                SW_HIDE
            } else {
                SW_SHOWDEFAULT
            }
        );
        if flags & PROCESS_DETACHED != 0 {
            assert_ne!(pf & DETACHED_PROCESS, 0);
            assert_ne!(pf & CREATE_NEW_PROCESS_GROUP, 0);
            assert_eq!(pf & CREATE_SUSPENDED, 0, "detached never suspends");
        } else {
            assert_ne!(
                pf & CREATE_SUSPENDED,
                0,
                "non-detached suspends for job assign"
            );
            assert_eq!(pf & (DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP), 0);
        }
    }
}

// ───────────────────────── pure KATs: kill shapes ─────────────────────────

/// Range/emulation table without touching any process. // quirk: PROC-51
#[test]
fn kill_signal_range_shapes() {
    // Range checks run before the handle is used.
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, -1),
        Err(KillError::InvalidSignal)
    );
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, NSIG),
        Err(KillError::InvalidSignal)
    );
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, 100),
        Err(KillError::InvalidSignal)
    );
    // In-range signals without a Windows emulation — including SIGHUP(1),
    // SIGBREAK(21) and SIGWINCH(28).
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, 1),
        Err(KillError::Unsupported)
    );
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, 21),
        Err(KillError::Unsupported)
    );
    assert_eq!(
        kill_raw(INVALID_HANDLE_VALUE, 28),
        Err(KillError::Unsupported)
    );
    // Nonexistent pid: OpenProcess INVALID_PARAMETER → NotFound.
    // // quirk: PROC-54
    assert_eq!(kill_pid(u32::MAX, SIGTERM), Err(KillError::NotFound));
    // pid 0 = self, signal 0 = liveness probe: we are alive. // quirk: PROC-53
    assert_eq!(kill_pid(0, 0), Ok(()));
}

// ───────────────────────── filesystem: search matrix ─────────────────────────

/// // quirk: PROC-15, PROC-16, PROC-17, PROC-18, PROC-19, PROC-20, PROC-22,
/// PROC-23
#[test]
fn path_search_resolution_matrix() {
    let _guard = serial(); // mutates process env (the PROC-18 gate)
    let dir_a = scratch_dir("searchA");
    let dir_b = scratch_dir("searchB");
    let a = dir_a.to_str().expect("ascii temp").to_string();
    let b = dir_b.to_str().expect("ascii temp").to_string();
    const FILES: [&str; 5] = ["tool.com", "tool.exe", "only-exe.exe", "weird.bar", "noext"];
    for f in FILES {
        write_file(&format!("{a}\\{f}"), b"not a real PE");
    }
    mkdir(&format!("{a}\\dirtool.exe"));
    let cwd = w(&b);
    let path = w(&a);
    let find = |file: &str, path: Option<&[u16]>, flags: u32| {
        search_path(&w(file), &cwd, path, flags).map(|v| from_w(&v))
    };
    let in_a = |f: &str| Some(format!("{a}\\{f}"));

    // .com beats .exe; extensions are APPENDED, never substituted.
    assert_eq!(find("tool", Some(&path), 0), in_a("tool.com"));
    assert_eq!(find("only-exe", Some(&path), 0), in_a("only-exe.exe"));
    assert_eq!(find("tool.exe", Some(&path), 0), in_a("tool.exe"));
    assert_eq!(find("weird.bar", Some(&path), 0), in_a("weird.bar"));
    assert_eq!(find("weird", Some(&path), 0), None);
    // Extension-less needs EXACT_NAME *and* a directory component.
    // // quirk: PROC-17
    assert_eq!(find("noext", Some(&path), 0), None);
    assert_eq!(
        find("noext", Some(&path), PROCESS_FILE_PATH_EXACT_NAME),
        None
    );
    let explicit = format!("{a}\\noext");
    assert_eq!(
        find(&explicit, Some(&path), PROCESS_FILE_PATH_EXACT_NAME),
        Some(explicit.clone())
    );
    assert_eq!(find(&explicit, Some(&path), 0), None);
    // Directories never match the probe. // quirk: PROC-23
    assert_eq!(find("dirtool", Some(&path), 0), None);
    // Empty / dot specs are rejected outright. // quirk: PROC-22
    assert_eq!(find("", Some(&path), 0), None);
    assert_eq!(find(".", Some(&path), 0), None);
    assert_eq!(find("..", Some(&path), 0), None);
    // Odd PATH spellings: leading/doubled separators, quotes (both kinds),
    // unterminated quote. // quirk: PROC-19, PROC-20
    for spelled in [
        format!(";;;{a}"),
        format!("\"{a}\";C:\\nope"),
        format!("'{a}';C:\\nope"),
        format!("\"{a}"),
        format!("C:\\nope;{a};"),
    ] {
        let p = w(&spelled);
        assert_eq!(
            find("tool", Some(&p), 0),
            in_a("tool.com"),
            "PATH={spelled}"
        );
    }
    // No PATH at all: bare names search cwd only (and miss). // quirk: PROC-15
    assert_eq!(find("tool", None, 0), None);

    // The NoDefaultCurrentDirectoryInExePath gate: cwd is skipped when set.
    // // quirk: PROC-18
    write_file(&format!("{b}\\gated.exe"), b"x");
    write_file(&format!("{a}\\gated.exe"), b"x");
    let name_z = w("NoDefaultCurrentDirectoryInExePath\0");
    let one = w("1\0");
    // SAFETY: NUL-terminated name/value.
    unsafe { SetEnvironmentVariableW(name_z.as_ptr(), one.as_ptr()) };
    let gated_skip_cwd = find("gated", Some(&path), 0);
    // SAFETY: NUL-terminated name; null value deletes.
    unsafe { SetEnvironmentVariableW(name_z.as_ptr(), ptr::null()) };
    let gated_cwd_first = find("gated", Some(&path), 0);
    assert_eq!(gated_skip_cwd, in_a("gated.exe"));
    assert_eq!(gated_cwd_first, Some(format!("{b}\\gated.exe")));

    for f in FILES {
        rm_file(&format!("{a}\\{f}"));
    }
    rm_file(&format!("{a}\\gated.exe"));
    rm_file(&format!("{b}\\gated.exe"));
    rmdir(&format!("{a}\\dirtool.exe"));
    rmdir(&a);
    rmdir(&b);
}

// ───────────────────────── children: stdio round trip ─────────────────────────

/// Full composition with pipe.rs: parent writes → child (`more`) consumes →
/// child writes → parent reads → EOF; quoted (non-verbatim) command line;
/// exit code 0. // quirk: PROC-05, PROC-28, PROC-37, PROC-47
#[test]
fn spawn_stdio_pipe_round_trip_and_exit() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let lp: *mut Loop = &raw mut *loop_;
    let mut ctx = ExitCtx::new();
    let mut io = IoCtx::new();
    let io_ptr: *mut IoCtx = &raw mut *io;

    // Child ends are synchronous (non-overlapped) — the PROC-37 default for
    // CRT children; the engine duplicates them inheritable itself.
    let (stdin_srv, stdin_cli) = create_pair(&PairOptions {
        server_readable: false,
        server_writable: true,
        client_readable: true,
        client_writable: false,
        client_overlapped: false,
        client_inheritable: false,
    })
    .expect("stdin pair");
    let (stdout_srv, stdout_cli) = create_pair(&PairOptions {
        server_readable: true,
        server_writable: false,
        client_readable: false,
        client_writable: true,
        client_overlapped: false,
        client_inheritable: false,
    })
    .expect("stdout pair");

    let file = comspec();
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"more"];
    let stdio = [Stdio::Raw(stdin_cli), Stdio::Raw(stdout_cli), Stdio::Ignore];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: 0, // NON-verbatim: the quoted command-line path end-to-end
        stdio: &stdio,
        pseudoconsole: None,
    };
    // SAFETY: ctx/io outlive the handles; client handles are live.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
    assert_ne!(child.pid(), 0);
    // The parent's originals must be released or the child's stdout never
    // EOFs for us (the engine owns its own duplicates).
    // SAFETY: created above, not used again.
    unsafe {
        CloseHandle(stdin_cli);
        CloseHandle(stdout_cli);
    }

    // SAFETY: server handles are live overlapped ends; lp is pinned.
    let mut stdin_pipe = unsafe { PipeHandle::open(lp, stdin_srv) }.expect("open stdin");
    // SAFETY: same contract as the stdin end above.
    let mut stdout_pipe = unsafe { PipeHandle::open(lp, stdout_srv) }.expect("open stdout");
    let mut read_buf = vec![0u8; 65536].into_boxed_slice();
    // SAFETY: read_buf outlives the pipe close; io outlives the callbacks.
    unsafe {
        stdout_pipe
            .read_start(
                read_buf.as_mut_ptr(),
                read_buf.len(),
                on_pipe_read,
                io_ptr.cast::<c_void>(),
            )
            .expect("read_start");
        stdin_pipe
            .write(
                &[b"ping-pong\r\n"],
                Some(on_pipe_write),
                io_ptr.cast::<c_void>(),
            )
            .expect("write");
    }

    // SAFETY: io is live for the whole test.
    tick_until(&mut loop_, 10_000, "stdin write", || unsafe {
        (*io_ptr).wrote
    });
    assert_eq!(io.write_err, Win32Error::SUCCESS);
    // EOF the child's stdin so `more` flushes and exits.
    stdin_pipe.close(Some(on_pipe_close), io_ptr.cast::<c_void>());

    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx/io live.
    tick_until(&mut loop_, 20_000, "child exit + stdout EOF", || unsafe {
        (*ctx_ptr).fired && (*io_ptr).eof
    });
    let text = ascii(&io.received);
    assert!(text.contains("ping-pong"), "stdout was: {text:?}");
    assert_eq!(io.read_err, Win32Error::BROKEN_PIPE); // raw EOF shape
    assert_eq!(ctx.code, 0);
    assert_eq!(ctx.signal, 0);

    stdout_pipe.close(Some(on_pipe_close), io_ptr.cast::<c_void>());
    // SAFETY: io live.
    tick_until(&mut loop_, 10_000, "pipe closes", || unsafe {
        (*io_ptr).closes == 2
    });
    close_and_drain(&mut loop_, &mut child, &mut ctx);
    assert!(!loop_.alive());
}

// ───────────────────────── children: exit codes ─────────────────────────

/// Full-DWORD delivery: 42, and an NTSTATUS-sized code > i32::MAX that must
/// not truncate. // quirk: PROC-47
#[test]
fn spawn_exit_code_delivery_full_dword() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let file = comspec();

    for (arg, expect) in [
        (&b"42"[..], 42i64),
        (&b"-1073741819"[..], 0xC000_0005u32 as i64), // 3221225477
    ] {
        let mut ctx = ExitCtx::new();
        let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", arg];
        let options = ProcessOptions {
            file: &file,
            args,
            env: None,
            cwd: None,
            flags: PROCESS_VERBATIM_ARGUMENTS,
            stdio: &[],
            pseudoconsole: None,
        };
        // SAFETY: ctx outlives the handle.
        let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
        let ctx_ptr: *const ExitCtx = &raw const *ctx;
        // SAFETY: ctx live.
        tick_until(&mut loop_, 20_000, "exit", || unsafe { (*ctx_ptr).fired });
        assert_eq!(ctx.code, expect);
        assert_eq!(ctx.signal, 0);
        assert!(child.has_exited());
        close_and_drain(&mut loop_, &mut child, &mut ctx);
    }
    assert!(!loop_.alive());
}

// ───────────────────────── children: the bug-#9 regression ─────────────────────────

/// An UNREF'D process must still fire its exit callback: exit observation is
/// decoupled from keep-alive. The loop reports not-alive the whole time —
/// exactly the state where the old coupling lost the callback forever.
/// // quirk: PROC-45
#[test]
fn unrefd_process_still_fires_exit_cb() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let mut ctx = ExitCtx::new();
    let file = comspec();
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"7"];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
    assert!(loop_.alive(), "ref'd process holds the loop");
    child.unref();
    assert!(
        !loop_.alive(),
        "unref'd process must not hold the loop open"
    );

    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "unref'd exit callback", || unsafe {
        (*ctx_ptr).fired
    });
    assert_eq!(ctx.code, 7);
    assert_eq!(ctx.signal, 0);

    close_and_drain(&mut loop_, &mut child, &mut ctx);
    assert!(!loop_.alive());
}

// ───────────────────────── children: kill ─────────────────────────

/// kill(SIGTERM) through the handle: exit code 1 with term_signal recorded;
/// a second kill hits the ESRCH latch. PATH resolution runs end-to-end
/// (bare "ping"). // quirk: PROC-51, PROC-55, PROC-48
#[test]
fn kill_term_records_signal_and_esrch_latch() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let mut ctx = ExitCtx::new();
    let args: &[&[u8]] = &[b"ping", b"-n", b"30", b"127.0.0.1"];
    let options = ProcessOptions {
        file: b"ping",
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn ping");
    assert_eq!(child.kill(SIGTERM), Ok(()));
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "killed exit", || unsafe {
        (*ctx_ptr).fired
    });
    assert_eq!(ctx.code, 1, "killed processes exit 1");
    assert_eq!(
        ctx.signal, SIGTERM,
        "kill via the handle reports the signal"
    );
    assert!(child.has_exited());
    assert_eq!(child.kill(SIGTERM), Err(KillError::NotFound)); // latch
    assert_eq!(child.kill(0), Err(KillError::NotFound));
    close_and_drain(&mut loop_, &mut child, &mut ctx);
}

/// kill_pid liveness + termination (signal NOT recorded — the PROC-55
/// asymmetry), then the ACCESS_DENIED→NotFound two-step probe on an
/// exited-but-handle-open process. // quirk: PROC-52, PROC-53, PROC-54,
/// PROC-55
#[test]
fn kill_pid_probe_and_two_step_disambiguation() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");

    // Phase 1: kill by pid — exit observed with signal 0.
    let mut ctx = ExitCtx::new();
    let args: &[&[u8]] = &[b"ping", b"-n", b"30", b"127.0.0.1"];
    let options = ProcessOptions {
        file: b"ping",
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn ping");
    let pid = child.pid();
    assert_eq!(kill_pid(pid, 0), Ok(()), "alive probe");
    assert_eq!(kill_pid(pid, SIGTERM), Ok(()));
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "pid-killed exit", || unsafe {
        (*ctx_ptr).fired
    });
    assert_eq!(ctx.code, 1);
    assert_eq!(ctx.signal, 0, "kill by pid must NOT report a term signal");
    close_and_drain(&mut loop_, &mut child, &mut ctx);

    // Phase 2: child exits on its own; WITHOUT ticking (so the latch cannot
    // engage), TerminateProcess on the still-open handle hits ACCESS_DENIED
    // and the two-step probe must turn it into NotFound.
    let mut ctx2 = ExitCtx::new();
    let file = comspec();
    let args2: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"0"];
    let options2 = ProcessOptions {
        file: &file,
        args: args2,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    // SAFETY: ctx2 outlives the handle.
    let mut child2 = unsafe { spawn_with(&mut loop_, &options2, &mut ctx2) }.expect("spawn");
    // Wait until the process HANDLE is signaled — no loop ticks, no exit
    // dispatch. (GetExitCodeProcess turns positive before the handle
    // signals, and in that window TerminateProcess can still SUCCEED — the
    // inverse direction of the documented unfixable race; only the signaled
    // state makes ACCESS_DENIED deterministic.) // quirk: PROC-52
    // SAFETY: the handle is live (exit not yet dispatched).
    let waited = unsafe { WaitForSingleObject(child2.raw_handle(), 20_000) };
    assert_eq!(waited, Ok(WAIT_OBJECT_0), "child never exited");
    assert!(!ctx2.fired, "exit not dispatched yet");
    assert!(!child2.has_exited(), "latch must not be set yet");
    assert_eq!(
        child2.kill(0),
        Err(KillError::NotFound),
        "probe sees the exit"
    );
    assert_eq!(
        child2.kill(SIGTERM),
        Err(KillError::NotFound),
        "ACCESS_DENIED must disambiguate to NotFound"
    );
    let ctx2_ptr: *const ExitCtx = &raw const *ctx2;
    // SAFETY: ctx2 live.
    tick_until(&mut loop_, 20_000, "exit dispatch", || unsafe {
        (*ctx2_ptr).fired
    });
    assert_eq!(ctx2.code, 0);
    close_and_drain(&mut loop_, &mut child2, &mut ctx2);
}

// ───────────────────────── children: detached ─────────────────────────

/// A detached child survives handle close AND loop destruction (close never
/// kills); cleaned up by pid. // quirk: PROC-40, PROC-49
#[test]
fn detached_child_outlives_closed_handle_and_loop() {
    let _guard = serial();
    let pid;
    {
        let mut loop_ = Loop::new().expect("loop");
        let mut ctx = ExitCtx::new();
        let args: &[&[u8]] = &[b"ping", b"-n", b"30", b"127.0.0.1"];
        let options = ProcessOptions {
            file: b"ping",
            args,
            env: None,
            cwd: None,
            flags: PROCESS_VERBATIM_ARGUMENTS | PROCESS_DETACHED,
            stdio: &[],
            pseudoconsole: None,
        };
        // SAFETY: ctx outlives the handle.
        let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
        pid = child.pid();
        close_and_drain(&mut loop_, &mut child, &mut ctx);
        assert!(!ctx.fired, "close must not synthesize an exit");
        assert!(!loop_.alive());
        drop(child);
    } // loop destroyed

    assert_eq!(kill_pid(pid, 0), Ok(()), "detached child still alive");
    assert_eq!(kill_pid(pid, SIGTERM), Ok(()));
    // Bounded reap-wait so the suite leaves nothing behind.
    for _ in 0..1000 {
        if kill_pid(pid, 0) == Err(KillError::NotFound) {
            return;
        }
        std::thread::yield_now();
    }
    panic!("detached child did not die after SIGTERM");
}

/// Job membership is observable: the runtime itself and normal children are
/// in the kill-on-close job; detached children are not. // quirk: PROC-42,
/// PROC-43, PROC-44, PROC-40
#[test]
fn job_membership_normal_vs_detached() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let job = global_job();
    assert!(!job.is_null(), "global job must exist on a dev machine");

    let in_job = |pid: u32| -> bool {
        // SAFETY: by-value args; result checked.
        let h = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | SYNCHRONIZE, FALSE, pid) };
        assert!(!h.is_null(), "OpenProcess({pid})");
        let mut b: BOOL = 0;
        // SAFETY: both handles live; valid out-pointer.
        let ok = unsafe { IsProcessInJob(h, job, &raw mut b) };
        // SAFETY: opened above.
        unsafe { CloseHandle(h) };
        assert!(ok != 0, "IsProcessInJob");
        b != 0
    };

    // PROC-44 self-assign: the current process is a member.
    let mut self_in: BOOL = 0;
    // SAFETY: pseudo handle + live job + valid out-pointer.
    let ok = unsafe { IsProcessInJob(GetCurrentProcess(), job, &raw mut self_in) };
    assert!(ok != 0 && self_in != 0, "self-assign at job init");

    let args: &[&[u8]] = &[b"ping", b"-n", b"30", b"127.0.0.1"];
    let mk = |flags: u32| ProcessOptions {
        file: b"ping",
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS | flags,
        stdio: &[],
        pseudoconsole: None,
    };
    let mut ctx_n = ExitCtx::new();
    let mut ctx_d = ExitCtx::new();
    // SAFETY: ctxs outlive the handles.
    let mut normal = unsafe { spawn_with(&mut loop_, &mk(0), &mut ctx_n) }.expect("spawn");
    // SAFETY: same contract as the spawn above.
    let mut detached =
        unsafe { spawn_with(&mut loop_, &mk(PROCESS_DETACHED), &mut ctx_d) }.expect("spawn");

    assert!(in_job(normal.pid()), "normal child joins the job");
    assert!(!in_job(detached.pid()), "detached child stays out");

    assert_eq!(normal.kill(SIGKILL), Ok(()));
    assert_eq!(detached.kill(SIGKILL), Ok(()));
    let np: *const ExitCtx = &raw const *ctx_n;
    let dp: *const ExitCtx = &raw const *ctx_d;
    // SAFETY: ctxs live.
    tick_until(&mut loop_, 20_000, "both exits", || unsafe {
        (*np).fired && (*dp).fired
    });
    close_and_drain(&mut loop_, &mut normal, &mut ctx_n);
    close_and_drain(&mut loop_, &mut detached, &mut ctx_d);
}

// ───────────────────────── children: environment ─────────────────────────

/// The child observes the BUILT block: dedup last-wins, required-var
/// injection (cmd's own `set` output proves SystemRoot arrived), and no
/// leakage of parent-only vars. // quirk: PROC-08, PROC-10
#[test]
fn spawn_env_block_reaches_child() {
    let _guard = serial();
    // Parent-only canary that must NOT leak into the explicit env block.
    let canary = w("BUN_IOCP_PROC_CANARY\0");
    let one = w("present\0");
    // SAFETY: NUL-terminated name/value.
    unsafe { SetEnvironmentVariableW(canary.as_ptr(), one.as_ptr()) };

    let mut loop_ = Loop::new().expect("loop");
    let lp: *mut Loop = &raw mut *loop_;
    let mut ctx = ExitCtx::new();
    let mut io = IoCtx::new();
    let io_ptr: *mut IoCtx = &raw mut *io;

    let (out_srv, out_cli) = create_pair(&PairOptions {
        server_readable: true,
        server_writable: false,
        client_readable: false,
        client_writable: true,
        client_overlapped: false,
        client_inheritable: false,
    })
    .expect("stdout pair");

    let file = comspec();
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"set"];
    let env: &[&[u8]] = &[b"FOO=bar", b"FOO=baz", b"BUN_TEST_ALPHA=1"];
    let stdio = [Stdio::Ignore, Stdio::Raw(out_cli), Stdio::Ignore];
    let options = ProcessOptions {
        file: &file,
        args,
        env: Some(env),
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &stdio,
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle; out_cli is live.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
    // SAFETY: created above, not used again.
    unsafe { CloseHandle(out_cli) };

    // SAFETY: out_srv is a live overlapped end; lp pinned.
    let mut out_pipe = unsafe { PipeHandle::open(lp, out_srv) }.expect("open stdout");
    let mut read_buf = vec![0u8; 65536].into_boxed_slice();
    // SAFETY: read_buf outlives the close; io outlives the callbacks.
    unsafe {
        out_pipe
            .read_start(
                read_buf.as_mut_ptr(),
                read_buf.len(),
                on_pipe_read,
                io_ptr.cast::<c_void>(),
            )
            .expect("read_start");
    }
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx/io live.
    tick_until(&mut loop_, 20_000, "set output + exit", || unsafe {
        (*ctx_ptr).fired && (*io_ptr).eof
    });
    // SAFETY: NUL-terminated name; null deletes the canary.
    unsafe { SetEnvironmentVariableW(canary.as_ptr(), ptr::null()) };

    let text = ascii(&io.received).to_ascii_lowercase();
    assert!(text.contains("foo=baz"), "last duplicate wins: {text}");
    assert!(!text.contains("foo=bar"), "first duplicate dropped: {text}");
    assert!(text.contains("bun_test_alpha=1"), "{text}");
    // Required-var injection: cmd's `set` lists SystemRoot even though the
    // caller block never set it. // quirk: PROC-08
    assert!(text.contains("systemroot="), "{text}");
    assert!(
        !text.contains("bun_iocp_proc_canary"),
        "explicit env must not merge the parent's: {text}"
    );
    assert_eq!(ctx.code, 0);

    out_pipe.close(Some(on_pipe_close), io_ptr.cast::<c_void>());
    // SAFETY: io live.
    tick_until(&mut loop_, 10_000, "pipe close", || unsafe {
        (*io_ptr).closes == 1
    });
    close_and_drain(&mut loop_, &mut child, &mut ctx);
}

// ───────────────────────── children: cwd ─────────────────────────

/// Explicit cwd reaches the child; a ≥MAX_PATH cwd takes the 8.3-shortening
/// path (or fails with exactly the shortener's error on no-8.3 volumes).
/// // quirk: PROC-24
#[test]
fn spawn_cwd_explicit_and_long() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let dir = scratch_dir("cwdtest");
    let marker = dir
        .file_name()
        .expect("has name")
        .to_str()
        .expect("ascii")
        .to_ascii_lowercase();

    let run_cd = |loop_: &mut Loop, cwd: &[u8]| -> (Result<i64, Win32Error>, String) {
        let lp: *mut Loop = loop_;
        let mut ctx = ExitCtx::new();
        let mut io = IoCtx::new();
        let io_ptr: *mut IoCtx = &raw mut *io;
        let (out_srv, out_cli) = create_pair(&PairOptions {
            server_readable: true,
            server_writable: false,
            client_readable: false,
            client_writable: true,
            client_overlapped: false,
            client_inheritable: false,
        })
        .expect("pair");
        let file = comspec();
        let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"cd"];
        let stdio = [Stdio::Ignore, Stdio::Raw(out_cli), Stdio::Ignore];
        let options = ProcessOptions {
            file: &file,
            args,
            env: None,
            cwd: Some(cwd),
            flags: PROCESS_VERBATIM_ARGUMENTS,
            stdio: &stdio,
            pseudoconsole: None,
        };
        // SAFETY: ctx outlives the handle; out_cli live.
        let spawned = unsafe { spawn_with(loop_, &options, &mut ctx) };
        // SAFETY: created above.
        unsafe { CloseHandle(out_cli) };
        match spawned {
            Err(e) => {
                // SAFETY: created above; never adopted on this path.
                unsafe { CloseHandle(out_srv) };
                (Err(e), String::new())
            }
            Ok(mut child) => {
                // SAFETY: live overlapped end.
                let mut pipe = unsafe { PipeHandle::open(lp, out_srv) }.expect("open");
                let mut buf = vec![0u8; 65536].into_boxed_slice();
                // SAFETY: buf outlives the close; io outlives callbacks.
                unsafe {
                    pipe.read_start(
                        buf.as_mut_ptr(),
                        buf.len(),
                        on_pipe_read,
                        io_ptr.cast::<c_void>(),
                    )
                    .expect("read_start");
                }
                let ctx_ptr: *const ExitCtx = &raw const *ctx;
                // SAFETY: ctx/io live.
                tick_until(loop_, 20_000, "cd output", || unsafe {
                    (*ctx_ptr).fired && (*io_ptr).eof
                });
                pipe.close(Some(on_pipe_close), io_ptr.cast::<c_void>());
                // SAFETY: io live.
                tick_until(loop_, 10_000, "pipe close", || unsafe {
                    (*io_ptr).closes == 1
                });
                close_and_drain(loop_, &mut child, &mut ctx);
                let text = ascii(&io.received).to_ascii_lowercase();
                (Ok(ctx.code), text)
            }
        }
    };

    let (code, text) = run_cd(&mut loop_, dir.to_str().expect("ascii").as_bytes());
    assert_eq!(code, Ok(0));
    assert!(text.contains(&marker), "cd printed {text:?}");

    // ≥ MAX_PATH cwd: behavior is pinned to the shortener's own verdict.
    // Each segment is created via the \\?\ form (works regardless of the
    // LongPathsEnabled registry state); the spawn deliberately gets the
    // PLAIN form — CreateProcessW rejects \\?\ cwd. // quirk: PROC-24
    let mut long = dir.clone();
    let mut created: Vec<String> = Vec::new();
    while long.to_str().expect("ascii").len() < MAX_PATH + 20 {
        long = long.join("a-very-long-directory-segment-0123456789");
        let seg = long.to_str().expect("ascii").to_string();
        mkdir(&format!(r"\\?\{seg}"));
        created.push(seg);
    }
    let long_str = long.to_str().expect("ascii");
    assert!(long_str.len() >= MAX_PATH);
    match short_path_name(&w(long_str)) {
        Ok(short) => {
            assert!(short.len() < MAX_PATH, "8.3 form fits");
            let (code, _) = run_cd(&mut loop_, long_str.as_bytes());
            assert_eq!(code, Ok(0), "long cwd spawns via the 8.3 form");
        }
        Err(e) => {
            // 8.3 generation disabled on this volume: the spawn must surface
            // exactly the shortener's error, never silently truncate.
            let (code, _) = run_cd(&mut loop_, long_str.as_bytes());
            assert_eq!(code, Err(e));
        }
    }
    for seg in created.iter().rev() {
        rmdir(&format!(r"\\?\{seg}"));
    }
    rmdir(dir.to_str().expect("ascii"));
}

// ───────────────────────── children: failure shapes ─────────────────────────

/// Synchronous raw-coded failures, plus the PROC-32 forgiveness positive.
/// // quirk: PROC-50, PROC-58, PROC-59, PROC-30, PROC-32
#[test]
fn spawn_failure_shapes() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let mut ctx = ExitCtx::new();
    let file = comspec();
    let dir = scratch_dir("failures");
    let args_x: &[&[u8]] = &[b"x"];

    fn spawn_err(loop_: &mut Loop, ctx: &mut ExitCtx, options: &ProcessOptions<'_>) -> Win32Error {
        // SAFETY: ctx outlives any (never-created) handle.
        match unsafe { spawn_with(loop_, options, ctx) } {
            Err(e) => e,
            Ok(_) => panic!("spawn must fail"),
        }
    }
    fn opts<'a>(file: &'a [u8], args: &'a [&'a [u8]], stdio: &'a [Stdio]) -> ProcessOptions<'a> {
        ProcessOptions {
            file,
            args,
            env: None,
            cwd: None,
            flags: PROCESS_VERBATIM_ARGUMENTS,
            stdio,
            pseudoconsole: None,
        }
    }

    // Search miss: the exact raw code node maps to ENOENT. // quirk: PROC-58
    assert_eq!(
        spawn_err(
            &mut loop_,
            &mut ctx,
            &opts(b"bun-test-definitely-not-here-1234", args_x, &[])
        ),
        Win32Error::FILE_NOT_FOUND
    );

    // Non-PE image: the loader's rejection must reach the consumer RAW for
    // its EFTYPE mapping. Win11 x64 reports EXE_MACHINE_TYPE_MISMATCH(216)
    // where older builds said BAD_EXE_FORMAT(193) — pin exact passthrough
    // against a direct CreateProcessW oracle, plus the two known shapes.
    let garbage = format!("{}\\garbage.exe", dir.to_str().expect("ascii"));
    write_file(&garbage, b"this is not a real PE file");
    let garbage_bytes = garbage.as_bytes().to_vec();
    let oracle = {
        let mut path_z = to_utf16(&garbage_bytes);
        path_z.push(0);
        let mut cmd: Vec<u16> = w("garbage\0");
        let mut si = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as DWORD,
            lpReserved: ptr::null_mut(),
            lpDesktop: ptr::null_mut(),
            lpTitle: ptr::null_mut(),
            dwX: 0,
            dwY: 0,
            dwXSize: 0,
            dwYSize: 0,
            dwXCountChars: 0,
            dwYCountChars: 0,
            dwFillAttribute: 0,
            dwFlags: 0,
            wShowWindow: 0,
            cbReserved2: 0,
            lpReserved2: ptr::null_mut(),
            hStdInput: ptr::null_mut(),
            hStdOutput: ptr::null_mut(),
            hStdError: ptr::null_mut(),
        };
        let mut info = PROCESS_INFORMATION {
            hProcess: ptr::null_mut(),
            hThread: ptr::null_mut(),
            dwProcessId: 0,
            dwThreadId: 0,
        };
        // SAFETY: NUL-terminated strings; valid out-structs.
        let ok = unsafe {
            CreateProcessW(
                path_z.as_ptr(),
                cmd.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                0,
                ptr::null_mut(),
                ptr::null(),
                &raw mut si,
                &raw mut info,
            )
        };
        assert_eq!(ok, 0, "the loader must reject a text file");
        Win32Error::get()
    };
    let raw = spawn_err(&mut loop_, &mut ctx, &opts(&garbage_bytes, args_x, &[]));
    assert_eq!(raw, oracle, "loader error must pass through unmapped");
    assert!(
        raw == Win32Error::BAD_EXE_FORMAT || raw == Win32Error(216),
        "unexpected loader rejection shape: {raw:?}"
    );

    // Bad cwd: ERROR_DIRECTORY (the POSIX-chdir-flavored ENOENT source).
    let mut bad_cwd = opts(&file, args_x, &[]);
    bad_cwd.cwd = Some(b"C:\\bun-test-no-such-dir-5678\\nested");
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &bad_cwd),
        Win32Error::DIRECTORY
    );

    // Validation: empty file/args; fd cap; invalid WTF-8. // quirk: PROC-59
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(b"", args_x, &[])),
        Win32Error::INVALID_PARAMETER
    );
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(b"x", &[], &[])),
        Win32Error::INVALID_PARAMETER
    );
    let big = vec![Stdio::Ignore; 256];
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(&file, args_x, &big)),
        Win32Error::NOT_SUPPORTED
    );
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(&[0xC0, 0x80], args_x, &[])),
        Win32Error::INVALID_PARAMETER
    );

    // PROC-30: every poison value DuplicateHandle would happily copy is
    // filtered — NULL, INVALID, and the CRT's (HANDLE)-2 sentinel.
    for poison in [
        ptr::null_mut(),
        INVALID_HANDLE_VALUE,
        ptr::without_provenance_mut::<c_void>(usize::MAX - 1),
    ] {
        assert_eq!(
            duplicate_inheritable(poison),
            Err(Win32Error::INVALID_HANDLE)
        );
    }
    // ...and a sentinel in a created-handle slot fails the spawn.
    let stdio_bad = [
        Stdio::Ignore,
        Stdio::Ignore,
        Stdio::Ignore,
        Stdio::Raw(INVALID_HANDLE_VALUE),
    ];
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(&file, args_x, &stdio_bad)),
        Win32Error::INVALID_HANDLE
    );
    let stdio_bad_fd = [
        Stdio::Ignore,
        Stdio::Ignore,
        Stdio::Ignore,
        Stdio::InheritFd(INVALID_HANDLE_VALUE),
    ];
    assert_eq!(
        spawn_err(&mut loop_, &mut ctx, &opts(&file, args_x, &stdio_bad_fd)),
        Win32Error::INVALID_HANDLE
    );

    // ...but an invalid INHERITED fd 0-2 is forgiven and the spawn works.
    // // quirk: PROC-32
    let forgiven_stdio = [Stdio::InheritFd(INVALID_HANDLE_VALUE)];
    let args_ok: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"0"];
    let forgiven = ProcessOptions {
        file: &file,
        args: args_ok,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &forgiven_stdio,
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &forgiven, &mut ctx) }
        .expect("invalid inherited stdin must be forgiven");
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "forgiven exit", || unsafe {
        (*ctx_ptr).fired
    });
    assert_eq!(ctx.code, 0);
    close_and_drain(&mut loop_, &mut child, &mut ctx);

    rm_file(&garbage);
    rmdir(dir.to_str().expect("ascii"));
}

// ───────────────────────── children: the PROC-33 fix ─────────────────────────

/// A stray INHERITABLE handle in the parent must NOT leak into the child:
/// with the explicit handle list, closing the parent's write end EOFs the
/// pipe immediately even while the child lives. Without the fix the child
/// holds a leaked copy and the EOF never comes. // quirk: PROC-33
#[test]
fn handle_list_blocks_stray_inheritable_leak() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let lp: *mut Loop = &raw mut *loop_;
    let mut ctx = ExitCtx::new();
    let mut io = IoCtx::new();
    let io_ptr: *mut IoCtx = &raw mut *io;

    // The stray: an inheritable write end the child is NOT given.
    let (stray_srv, stray_cli) = create_pair(&PairOptions {
        server_readable: true,
        server_writable: false,
        client_readable: false,
        client_writable: true,
        client_overlapped: false,
        client_inheritable: true,
    })
    .expect("stray pair");

    let args: &[&[u8]] = &[b"ping", b"-n", b"30", b"127.0.0.1"];
    let options = ProcessOptions {
        file: b"ping",
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[], // NUL stdio only — the stray is not in the handle list
        pseudoconsole: None,
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("spawn");
    // Drop the parent's only copy of the write end.
    // SAFETY: created above, not used again.
    unsafe { CloseHandle(stray_cli) };

    // SAFETY: live overlapped end; lp pinned.
    let mut pipe = unsafe { PipeHandle::open(lp, stray_srv) }.expect("open stray");
    let mut buf = vec![0u8; 4096].into_boxed_slice();
    // SAFETY: buf outlives the close; io outlives the callbacks.
    unsafe {
        pipe.read_start(
            buf.as_mut_ptr(),
            buf.len(),
            on_pipe_read,
            io_ptr.cast::<c_void>(),
        )
        .expect("read_start");
    }
    // EOF must arrive promptly while the child is still running — if the
    // write end leaked into the child this blocks until the child dies.
    tick_until(&mut loop_, 5_000, "stray-pipe EOF (handle leak?)", || {
        // SAFETY: io live.
        unsafe { (*io_ptr).eof }
    });
    assert_eq!(io.read_err, Win32Error::BROKEN_PIPE);
    assert!(!ctx.fired, "child must still be alive at EOF time");

    assert_eq!(child.kill(SIGKILL), Ok(()));
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "killed exit", || unsafe {
        (*ctx_ptr).fired
    });
    pipe.close(Some(on_pipe_close), io_ptr.cast::<c_void>());
    // SAFETY: io live.
    tick_until(&mut loop_, 10_000, "pipe close", || unsafe {
        (*io_ptr).closes == 1
    });
    close_and_drain(&mut loop_, &mut child, &mut ctx);
}

// ───────────────────────── misc surface ─────────────────────────

/// disable_stdio_inheritance is callable and idempotent (best-effort by
/// contract; the parsing hardening is pinned by the hostile-blob KATs).
/// // quirk: PROC-34
#[test]
fn disable_stdio_inheritance_smoke() {
    disable_stdio_inheritance();
    disable_stdio_inheritance();
}

/// to_utf16 helper sanity (test-local conversions match production).
#[test]
fn helper_round_trip() {
    assert_eq!(to_utf16(b"abc"), w("abc"));
}

// ─────────────────── children: handle liveness across exit_cb ───────────────────

struct ExitCbHandleCtx {
    handle: *mut ProcessHandle,
    fired: bool,
    times_ok: bool,
    exit_time_nonzero: bool,
    closes: u32,
    close_inside_cb: bool,
}

unsafe fn on_exit_query_times(_l: &mut Loop, data: *mut c_void, _code: i64, _signal: i32) {
    // SAFETY: data is the test's live ExitCbHandleCtx; `handle` was set after
    // spawn and the handle outlives the drain.
    unsafe {
        let ctx = &mut *data.cast::<ExitCbHandleCtx>();
        ctx.fired = true;
        let h = (*ctx.handle).raw_handle();
        let mut c = bun_windows_sys::FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut e = bun_windows_sys::FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut k = bun_windows_sys::FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let mut u = bun_windows_sys::FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        ctx.times_ok = bun_windows_sys::GetProcessTimes(
            h,
            &raw mut c,
            &raw mut e,
            &raw mut k,
            &raw mut u,
        ) != 0;
        // The child has exited, so its exit time must be a real timestamp —
        // proves the handle still addresses the dead process, not garbage.
        ctx.exit_time_nonzero = e.dwLowDateTime != 0 || e.dwHighDateTime != 0;
        if ctx.close_inside_cb {
            (*ctx.handle).close(Some(on_exit_cb_handle_close), data);
        }
    }
}

unsafe fn on_exit_cb_handle_close(_l: &mut Loop, data: *mut c_void) {
    // SAFETY: data is the test's live ExitCbHandleCtx.
    unsafe { (*data.cast::<ExitCbHandleCtx>()).closes += 1 };
}

/// The process HANDLE must stay open across the exit callback so exit-time
/// rusage (GetProcessTimes) works — the `raw_handle()` contract.
#[test]
fn exit_cb_can_query_process_times() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let file = comspec();
    let mut ctx = Box::new(ExitCbHandleCtx {
        handle: ptr::null_mut(),
        fired: false,
        times_ok: false,
        exit_time_nonzero: false,
        closes: 0,
        close_inside_cb: false,
    });
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"0"];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    let lp: *mut Loop = &raw mut *loop_;
    // SAFETY: ctx is heap-pinned and outlives the handle.
    let mut child = unsafe {
        ProcessHandle::spawn(
            lp,
            &options,
            Some(on_exit_query_times),
            ptr::from_mut(&mut *ctx).cast::<c_void>(),
        )
    }
    .expect("spawn");
    ctx.handle = &raw mut *child;
    let ctx_ptr: *const ExitCbHandleCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "exit", || unsafe { (*ctx_ptr).fired });
    assert!(ctx.times_ok, "GetProcessTimes failed inside exit_cb");
    assert!(ctx.exit_time_nonzero, "exit time empty — stale handle?");
    // After the callback the dispatcher's eager close must have run.
    assert_eq!(child.raw_handle(), INVALID_HANDLE_VALUE);
    let before = ctx.closes;
    child.close(Some(on_exit_cb_handle_close), ptr::from_mut(&mut *ctx).cast::<c_void>());
    // SAFETY: ctx live.
    tick_until(&mut loop_, 10_000, "close", || unsafe {
        (*ctx_ptr).closes > before
    });
    assert!(!loop_.alive());
}

/// Closing the handle from inside its own exit callback must be safe (the
/// consumer's standard pattern) — no double-close, close_cb runs once.
#[test]
fn exit_cb_can_close_handle_inside() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let file = comspec();
    let mut ctx = Box::new(ExitCbHandleCtx {
        handle: ptr::null_mut(),
        fired: false,
        times_ok: false,
        exit_time_nonzero: false,
        closes: 0,
        close_inside_cb: true,
    });
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"7"];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: None,
    };
    let lp: *mut Loop = &raw mut *loop_;
    // SAFETY: ctx is heap-pinned and outlives the handle; the close_cb fires
    // before the box drops at end of test.
    let mut child = unsafe {
        ProcessHandle::spawn(
            lp,
            &options,
            Some(on_exit_query_times),
            ptr::from_mut(&mut *ctx).cast::<c_void>(),
        )
    }
    .expect("spawn");
    ctx.handle = &raw mut *child;
    let ctx_ptr: *const ExitCbHandleCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "exit+close", || unsafe {
        (*ctx_ptr).closes > 0
    });
    assert!(ctx.fired);
    assert!(ctx.times_ok);
    assert_eq!(ctx.closes, 1, "close_cb must fire exactly once");
    assert!(!loop_.alive());
}

// ─────────────────── children: ConPTY (pseudoconsole) ───────────────────

#[repr(C)]
#[derive(Copy, Clone)]
struct TestCoord {
    x: i16,
    y: i16,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreatePseudoConsole(
        size: TestCoord,
        hInput: bun_windows_sys::HANDLE,
        hOutput: bun_windows_sys::HANDLE,
        dwFlags: u32,
        phPC: *mut bun_windows_sys::HANDLE,
    ) -> i32;
    fn ClosePseudoConsole(hPC: bun_windows_sys::HANDLE);
    fn PeekNamedPipe(
        hNamedPipe: bun_windows_sys::HANDLE,
        lpBuffer: *mut c_void,
        nBufferSize: u32,
        lpBytesRead: *mut u32,
        lpTotalBytesAvail: *mut u32,
        lpBytesLeftThisMessage: *mut u32,
    ) -> i32;
    fn ReadFile(
        hFile: bun_windows_sys::HANDLE,
        lpBuffer: *mut c_void,
        nNumberOfBytesToRead: u32,
        lpNumberOfBytesRead: *mut u32,
        lpOverlapped: *mut c_void,
    ) -> i32;
}

/// Mixing a pseudoconsole with stdio slots is a contract violation, not a
/// silent ignore — fail-closed.
#[test]
fn conpty_with_stdio_slots_is_invalid_parameter() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");
    let file = comspec();
    let mut ctx = ExitCtx::new();
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"exit", b"0"];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[Stdio::Ignore],
        pseudoconsole: Some(8usize as bun_windows_sys::HANDLE),
    };
    // SAFETY: never spawns — rejected before any kernel call uses the bogus HPCON.
    let r = unsafe { spawn_with(&mut loop_, &options, &mut ctx) };
    assert_eq!(r.err(), Some(Win32Error::INVALID_PARAMETER));
    assert!(!loop_.alive());
}

/// End-to-end: a child spawned under a real pseudoconsole writes its output
/// through the ConPTY pipe — proves PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE +
/// NULL-std-handle wiring (the terminal#15814 contract).
#[test]
fn conpty_child_output_flows_through_pseudoconsole() {
    let _guard = serial();
    let mut loop_ = Loop::new().expect("loop");

    let mut in_read: bun_windows_sys::HANDLE = ptr::null_mut();
    let mut in_write: bun_windows_sys::HANDLE = ptr::null_mut();
    let mut out_read: bun_windows_sys::HANDLE = ptr::null_mut();
    let mut out_write: bun_windows_sys::HANDLE = ptr::null_mut();
    // SAFETY: out-params are locals.
    unsafe {
        assert_ne!(
            bun_windows_sys::CreatePipe(&raw mut in_read, &raw mut in_write, ptr::null_mut(), 0),
            0
        );
        assert_ne!(
            bun_windows_sys::CreatePipe(&raw mut out_read, &raw mut out_write, ptr::null_mut(), 0),
            0
        );
    }

    let mut hpc: bun_windows_sys::HANDLE = ptr::null_mut();
    // SAFETY: pipe ends are live; ConPTY duplicates what it needs.
    let hr = unsafe { CreatePseudoConsole(TestCoord { x: 80, y: 25 }, in_read, out_write, 0, &raw mut hpc) };
    assert_eq!(hr, 0, "CreatePseudoConsole HRESULT {hr:#x}");

    let file = comspec();
    let mut ctx = ExitCtx::new();
    let args: &[&[u8]] = &[b"cmd", b"/d", b"/c", b"echo", b"conpty-marker-ok"];
    let options = ProcessOptions {
        file: &file,
        args,
        env: None,
        cwd: None,
        flags: PROCESS_VERBATIM_ARGUMENTS,
        stdio: &[],
        pseudoconsole: Some(hpc),
    };
    // SAFETY: ctx outlives the handle.
    let mut child = unsafe { spawn_with(&mut loop_, &options, &mut ctx) }.expect("conpty spawn");
    let ctx_ptr: *const ExitCtx = &raw const *ctx;
    // SAFETY: ctx live.
    tick_until(&mut loop_, 20_000, "conpty exit", || unsafe { (*ctx_ptr).fired });
    assert_eq!(ctx.code, 0);

    // Drain whatever the ConPTY produced (VT init + the echo). The child has
    // exited, so all of its output is already buffered in the pipe.
    let mut collected = Vec::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        let mut avail: u32 = 0;
        // SAFETY: live pipe handle; out-params are locals.
        let ok = unsafe {
            PeekNamedPipe(out_read, ptr::null_mut(), 0, ptr::null_mut(), &raw mut avail, ptr::null_mut())
        };
        assert_ne!(ok, 0, "PeekNamedPipe failed");
        if avail > 0 {
            let mut buf = vec![0u8; avail as usize];
            let mut got: u32 = 0;
            // SAFETY: buf sized to avail; synchronous pipe read.
            let r = unsafe {
                ReadFile(out_read, buf.as_mut_ptr().cast::<c_void>(), avail, &raw mut got, ptr::null_mut())
            };
            assert_ne!(r, 0);
            collected.extend_from_slice(&buf[..got as usize]);
        }
        if collected.windows(16).any(|w| w == b"conpty-marker-ok") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        collected.windows(16).any(|w| w == b"conpty-marker-ok"),
        "marker not seen in {} ConPTY bytes",
        collected.len()
    );

    close_and_drain(&mut loop_, &mut child, &mut ctx);
    // SAFETY: teardown of test-owned objects, in the ConPTY-documented order.
    unsafe {
        ClosePseudoConsole(hpc);
        bun_windows_sys::CloseHandle(in_read);
        bun_windows_sys::CloseHandle(in_write);
        bun_windows_sys::CloseHandle(out_read);
        bun_windows_sys::CloseHandle(out_write);
    }
    assert!(!loop_.alive());
}
