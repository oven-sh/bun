//! TTY tests in three tiers: pure KATs over the translator/transform logic
//! (no console), loop-level rejection tests (no console), and a real-console
//! suite executed in a CREATE_NEW_CONSOLE child process — consoles are
//! process-global, so the fixture gets a fresh, isolated one regardless of
//! how the test runner itself was spawned. NO capability is silently
//! skipped: the parent asserts the child's explicit OK markers, and the
//! console-less branches assert the documented rejection shapes.

use core::ptr;
use std::io::Write as _;

use bun_windows_sys::kernel32::GetConsoleScreenBufferInfo;
use bun_windows_sys::{
    AllocConsole, BOOL, CONSOLE_SCREEN_BUFFER_INFO, COORD, CloseHandle, CreateFileW, CreatePipe,
    DWORD, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT, ENABLE_QUICK_EDIT_MODE,
    ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING, ENABLE_WINDOW_INPUT,
    ENHANCED_KEY, FILE_SHARE_READ, FILE_SHARE_WRITE, FlushConsoleInputBuffer, GENERIC_READ,
    GENERIC_WRITE, GetConsoleMode, HANDLE, INVALID_HANDLE_VALUE, KEY_EVENT, LEFT_ALT_PRESSED,
    LEFT_CTRL_PRESSED, MOUSE_EVENT, OPEN_EXISTING, RIGHT_ALT_PRESSED, SHIFT_PRESSED, VK_DELETE,
    VK_LEFT, VK_MENU, VK_NUMPAD1, VK_RETURN, VK_UP, WAIT_OBJECT_0, WINDOW_BUFFER_SIZE_EVENT, WORD,
    WaitForSingleObject, Win32Error, WriteConsoleInputW,
};

use super::*;
use crate::event_loop::Loop;
use crate::test_sync::serial;

// Console APIs needed only by the fixture (kept out of the production
// extern surface).
#[link(name = "kernel32")]
unsafe extern "system" {
    fn ReadConsoleOutputCharacterW(
        hConsoleOutput: HANDLE,
        lpCharacter: *mut u16,
        nLength: DWORD,
        dwReadCoord: COORD,
        lpNumberOfCharsRead: *mut DWORD,
    ) -> BOOL;
    fn SetConsoleScreenBufferSize(hConsoleOutput: HANDLE, dwSize: COORD) -> BOOL;
}

// ───────────────────────── record builders ─────────────────────────

fn key_rec(down: bool, vk: WORD, ch: u16, ctrl_state: DWORD, repeat: WORD) -> INPUT_RECORD {
    let mut r = zero_input_record();
    r.EventType = KEY_EVENT;
    r.Event = INPUT_RECORD_Event {
        KeyEvent: KEY_EVENT_RECORD {
            bKeyDown: if down { 1 } else { 0 },
            wRepeatCount: repeat,
            wVirtualKeyCode: vk,
            wVirtualScanCode: 0,
            uChar: KEY_EVENT_RECORD_uChar { UnicodeChar: ch },
            dwControlKeyState: ctrl_state,
        },
    };
    r
}

fn resize_rec() -> INPUT_RECORD {
    let mut r = zero_input_record();
    r.EventType = WINDOW_BUFFER_SIZE_EVENT;
    r
}

fn mouse_rec() -> INPUT_RECORD {
    let mut r = zero_input_record();
    r.EventType = MOUSE_EVENT;
    r
}

/// Drive records through the exact production translator + carryover/repeat
/// pump, collecting all emitted bytes. Each record is fully drained before
/// the next is loaded — the same invariant the dispatch drain maintains
/// (records are only fetched when no translated bytes remain).
fn pump(state: &mut RawKeyState, recs: &[INPUT_RECORD]) -> (Vec<u8>, u32) {
    let mut out = Vec::new();
    let mut resizes = 0;
    for r in recs {
        state.record = *r;
        if let RecordOutcome::Resize = translate_record(state) {
            resizes += 1;
        }
        while let Some(b) = state.next_byte() {
            out.push(b);
        }
    }
    (out, resizes)
}

fn pump_fresh(recs: &[INPUT_RECORD]) -> Vec<u8> {
    let mut s = RawKeyState::new();
    pump(&mut s, recs).0
}

// ───────────────────────── pure KATs ─────────────────────────

/// Exact byte KATs for the Cygwin-compatible VT100 table and the Alt/AltGr
/// prefix rules. // quirk: TTY-27, TTY-30
#[test]
fn vt100_table_and_alt_prefix_kats() {
    // Table rows, all four modifier variants where it matters.
    assert_eq!(vt100_fn_key(VK_UP, false, false), Some(&b"\x1b[A"[..]));
    assert_eq!(vt100_fn_key(VK_UP, true, false), Some(&b"\x1b[1;2A"[..]));
    assert_eq!(vt100_fn_key(VK_UP, false, true), Some(&b"\x1b[1;5A"[..]));
    assert_eq!(vt100_fn_key(VK_UP, true, true), Some(&b"\x1b[1;6A"[..]));
    assert_eq!(vt100_fn_key(VK_F1, false, false), Some(&b"\x1b[[A"[..]));
    assert_eq!(vt100_fn_key(VK_F1, true, false), Some(&b"\x1b[23~"[..]));
    assert_eq!(vt100_fn_key(VK_F1, false, true), Some(&b"\x1b[11^"[..]));
    assert_eq!(vt100_fn_key(VK_F1, true, true), Some(&b"\x1b[23^"[..]));
    assert_eq!(vt100_fn_key(VK_F5, false, false), Some(&b"\x1b[[E"[..]));
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_F6, false, false),
        Some(&b"\x1b[17~"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_F11, true, false),
        Some(&b"\x1b[23$"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_F11, true, true),
        Some(&b"\x1b[23@"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_HOME, false, false),
        Some(&b"\x1b[1~"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_END, false, false),
        Some(&b"\x1b[4~"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_INSERT, false, true),
        Some(&b"\x1b[2;5~"[..])
    );
    assert_eq!(vt100_fn_key(VK_DELETE, false, false), Some(&b"\x1b[3~"[..]));
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_DECIMAL, false, false),
        Some(&b"\x1b[3~"[..])
    );
    assert_eq!(
        vt100_fn_key(bun_windows_sys::VK_CLEAR, false, false),
        Some(&b"\x1b[G"[..])
    );
    // Unmappable keys: silently dropped.
    assert_eq!(vt100_fn_key(VK_RETURN, false, false), None);
    assert_eq!(vt100_fn_key(0x41, false, false), None);

    // Alt prefixes a character key — but NOT AltGr (Ctrl+Alt), which is how
    // international layouts deliver €/@. // quirk: TTY-30
    assert_eq!(
        pump_fresh(&[key_rec(true, 0x41, b'a' as u16, LEFT_ALT_PRESSED, 1)]),
        b"\x1ba"
    );
    assert_eq!(
        pump_fresh(&[key_rec(
            true,
            0x41,
            b'a' as u16,
            LEFT_ALT_PRESSED | LEFT_CTRL_PRESSED,
            1
        )]),
        b"a"
    );
    assert_eq!(
        pump_fresh(&[key_rec(
            true,
            0x41,
            b'a' as u16,
            RIGHT_ALT_PRESSED | LEFT_CTRL_PRESSED,
            1
        )]),
        b"a"
    );
    // Function keys prefix on any Alt; Ctrl is encoded in the table variant
    // (no AltGr exclusion). // quirk: TTY-30
    assert_eq!(
        pump_fresh(&[key_rec(
            true,
            VK_UP,
            0,
            LEFT_ALT_PRESSED | LEFT_CTRL_PRESSED | ENHANCED_KEY,
            1
        )]),
        b"\x1b\x1b[1;5A"
    );
    // Shift+Ctrl selects the fourth table column.
    assert_eq!(
        pump_fresh(&[key_rec(
            true,
            VK_UP,
            0,
            SHIFT_PRESSED | LEFT_CTRL_PRESSED | ENHANCED_KEY,
            1
        )]),
        b"\x1b[1;6A"
    );
}

/// WTF-8 encoder KATs, including the lone-surrogate scalars the raw reader
/// deliberately produces. // quirk: TTY-31
#[test]
fn wtf8_encode_kats() {
    let mut b = [0u8; 4];
    assert_eq!((wtf8_encode(0x24, &mut b), b[0]), (1, 0x24));
    let n = wtf8_encode(0xA2, &mut b);
    assert_eq!((n, &b[..2]), (2, &[0xC2, 0xA2][..]));
    let n = wtf8_encode(0x20AC, &mut b);
    assert_eq!((n, &b[..3]), (3, &[0xE2, 0x82, 0xAC][..]));
    let n = wtf8_encode(0x10348, &mut b);
    assert_eq!((n, &b[..4]), (4, &[0xF0, 0x90, 0x8D, 0x88][..]));
    // Lone high surrogate encodes like any 3-byte scalar (WTF-8).
    let n = wtf8_encode(0xD800, &mut b);
    assert_eq!((n, &b[..3]), (3, &[0xED, 0xA0, 0x80][..]));
}

/// Record-filter chain: keyups (with the Alt+Numpad compose exception),
/// fn-keys emitting exactly once per down+up pair, Alt+numpad keydown
/// suppression vs the gray (enhanced) twins, surrogate reassembly across
/// records, repeat expansion (and the repeat==0 adversarial input), resize
/// and mouse records. // quirk: TTY-28, TTY-29, TTY-31, TTY-32, TTY-50
#[test]
fn raw_record_filter_repeat_surrogate_kats() {
    // Plain char down+up: one emission (keyup dropped).
    assert_eq!(
        pump_fresh(&[
            key_rec(true, 0x41, b'a' as u16, 0, 1),
            key_rec(false, 0x41, b'a' as u16, 0, 1),
        ]),
        b"a"
    );
    // Fn key down+up: ONE sequence — the polarity regression here emitted
    // every fn key twice. // quirk: TTY-28
    assert_eq!(
        pump_fresh(&[
            key_rec(true, VK_UP, 0, ENHANCED_KEY, 1),
            key_rec(false, VK_UP, 0, ENHANCED_KEY, 1),
        ]),
        b"\x1b[A"
    );
    // VK_MENU keyup carrying the composed char (Alt+Numpad) IS emitted;
    // VK_MENU keyup without a char is not. // quirk: TTY-28
    assert_eq!(
        pump_fresh(&[key_rec(false, VK_MENU, 0xE9, 0, 1)]),
        [0xC3, 0xA9]
    );
    assert_eq!(pump_fresh(&[key_rec(false, VK_MENU, 0, 0, 1)]), b"");
    // Numpad keydowns during left-Alt composition are suppressed; the gray
    // (ENHANCED_KEY) arrow with Alt still emits. // quirk: TTY-29
    assert_eq!(
        pump_fresh(&[key_rec(true, VK_NUMPAD1, 0, LEFT_ALT_PRESSED, 1)]),
        b""
    );
    assert_eq!(
        pump_fresh(&[key_rec(
            true,
            VK_LEFT,
            0,
            LEFT_ALT_PRESSED | ENHANCED_KEY,
            1
        )]),
        b"\x1b\x1b[D"
    );
    // Full Alt+Numpad composition: suppressed digits, then the composed char
    // on the menu keyup.
    assert_eq!(
        pump_fresh(&[
            key_rec(true, VK_MENU, 0, LEFT_ALT_PRESSED, 1),
            key_rec(true, VK_NUMPAD1, 0, LEFT_ALT_PRESSED, 1),
            key_rec(false, VK_NUMPAD1, 0, LEFT_ALT_PRESSED, 1),
            key_rec(false, VK_MENU, 0xE9, 0, 1),
        ]),
        [0xC3, 0xA9]
    );
    // Surrogate pair across two records → one 4-byte scalar. 😀 = U+1F600.
    assert_eq!(
        pump_fresh(&[
            key_rec(true, 0, 0xD83D, 0, 1),
            key_rec(true, 0, 0xDE00, 0, 1),
        ]),
        [0xF0, 0x9F, 0x98, 0x80]
    );
    // Lone high surrogate followed by a BMP char: both degrade to WTF-8
    // instead of erroring. // quirk: TTY-31
    assert_eq!(
        pump_fresh(&[
            key_rec(true, 0, 0xD83D, 0, 1),
            key_rec(true, 0x41, b'A' as u16, 0, 1),
        ]),
        [0xED, 0xA0, 0xBD, b'A']
    );
    // Repeat expansion: one record, N keypresses. // quirk: TTY-32
    assert_eq!(
        pump_fresh(&[key_rec(true, 0x42, b'b' as u16, 0, 3)]),
        b"bbb"
    );
    assert_eq!(
        pump_fresh(&[key_rec(true, VK_UP, 0, ENHANCED_KEY, 2)]),
        b"\x1b[A\x1b[A"
    );
    // wRepeatCount == 0 is injectable via WriteConsoleInputW: emit once,
    // never the 65535-replay WORD underflow (deviation from libuv, which
    // wraps). // quirk: TTY-32
    assert_eq!(pump_fresh(&[key_rec(true, 0x43, b'c' as u16, 0, 0)]), b"c");
    // Resize records surface as Resize and emit nothing; mouse is skipped.
    let mut s = RawKeyState::new();
    let (bytes, resizes) = pump(&mut s, &[resize_rec(), mouse_rec()]);
    assert_eq!((bytes.as_slice(), resizes), (&b""[..], 1));
}

/// Partial-key carryover at the byte-pump level: stopping mid-sequence
/// preserves the remaining bytes for the next pump. // quirk: TTY-33
#[test]
fn raw_carryover_preserves_partial_sequence() {
    let mut s = RawKeyState::new();
    s.record = key_rec(true, VK_UP, 0, ENHANCED_KEY, 1);
    assert!(matches!(translate_record(&mut s), RecordOutcome::Key));
    // Consume two of three bytes, then "stop".
    assert_eq!(s.next_byte(), Some(0x1B));
    assert_eq!(s.next_byte(), Some(b'['));
    assert!(s.has_bytes());
    // The next drain resumes exactly where we left off.
    assert_eq!(s.next_byte(), Some(b'A'));
    assert_eq!(s.next_byte(), None);
    assert!(!s.has_bytes());
}

/// Write-transform KATs: EOL conversion (incl. cross-call state), 8192-unit
/// chunking, surrogate pairs never split (within a call or across calls),
/// lone surrogate pass-through, and the error policy (emission stops, state
/// advances). // quirk: TTY-15, TTY-16, TTY-23, TTY-12, TTY-13
#[test]
fn write_transform_eol_chunk_surrogate_kats() {
    fn run(seq: &[&[u16]]) -> (Vec<Vec<u16>>, u16, u16) {
        let mut high = 0u16;
        let mut eol = 0u16;
        let mut chunks: Vec<Vec<u16>> = Vec::new();
        for units in seq {
            let err = transform_units(&mut high, &mut eol, units, &mut |c| {
                chunks.push(c.to_vec());
                Win32Error::SUCCESS
            });
            assert_eq!(err, Win32Error::SUCCESS);
        }
        (chunks, high, eol)
    }
    fn flat(seq: &[&[u16]]) -> Vec<u16> {
        run(seq).0.concat()
    }
    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    // \n → \r\n; \r\n stays \r\n; lone \r passes; \n\r collapses.
    assert_eq!(flat(&[&w("a\nb")]), w("a\r\nb"));
    assert_eq!(flat(&[&w("a\r\nb")]), w("a\r\nb"));
    assert_eq!(flat(&[&w("a\rb")]), w("a\rb"));
    assert_eq!(flat(&[&w("a\n\rb")]), w("a\r\nb"));
    assert_eq!(flat(&[&w("\r\n\r")]), w("\r\n")); // second \r redundant
    // Cross-call state: the \r of a split \n\r is still collapsed, and the
    // \n of a split \r\n is not doubled. // quirk: TTY-16
    assert_eq!(flat(&[&w("a\n"), &w("\rb")]), w("a\r\nb"));
    assert_eq!(flat(&[&w("x\r"), &w("\ny")]), w("x\r\ny"));

    // Chunking at MAX_CONSOLE_CHAR. // quirk: TTY-15
    let big = vec![b'x' as u16; MAX_CONSOLE_CHAR + 8];
    let (chunks, _, _) = run(&[&big]);
    assert_eq!(
        chunks.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![MAX_CONSOLE_CHAR, 8]
    );
    // EOL expansion respects the cap: 5000 newlines = 10000 units out.
    let lots = vec![LF; 5000];
    let (chunks, _, _) = run(&[&lots]);
    assert_eq!(
        chunks.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![MAX_CONSOLE_CHAR, 10_000 - MAX_CONSOLE_CHAR]
    );
    assert!(chunks.concat().chunks(2).all(|p| p == [CR, LF]));
    // A surrogate pair at the chunk boundary flushes early rather than
    // splitting. // quirk: TTY-15
    let mut tail = vec![b'x' as u16; MAX_CONSOLE_CHAR - 1];
    tail.extend_from_slice(&[0xD83D, 0xDE00]);
    let (chunks, _, _) = run(&[&tail]);
    assert_eq!(
        chunks.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![MAX_CONSOLE_CHAR - 1, 2]
    );
    assert_eq!(chunks[1], vec![0xD83D, 0xDE00]);

    // A pair split ACROSS calls is held and joined. // quirk: TTY-12
    let (chunks, high, _) = run(&[&[0xD83D], &[0xDE00]]);
    assert_eq!(chunks, vec![vec![0xD83D, 0xDE00]]);
    assert_eq!(high, 0);
    // A held high surrogate followed by a non-low unit passes through
    // unmolested (WTF-16 fidelity). // quirk: TTY-13
    assert_eq!(
        flat(&[&[0xD800], &[b'A' as u16]]),
        vec![0xD800, b'A' as u16]
    );
    // A trailing lone LOW surrogate is not held (only highs can pair).
    assert_eq!(flat(&[&[0xDC00]]), vec![0xDC00]);

    // Error policy: the first emit error stops further emission but the
    // state still advances identically. // quirk: TTY-23
    let mut high = 0u16;
    let mut eol = 0u16;
    let mut calls = 0u32;
    let input = vec![LF; MAX_CONSOLE_CHAR]; // expands to 2 chunks
    let err = transform_units(&mut high, &mut eol, &input, &mut |_| {
        calls += 1;
        Win32Error::ACCESS_DENIED
    });
    assert_eq!(err, Win32Error::ACCESS_DENIED);
    assert_eq!(calls, 1, "emission must stop after the first error");
    assert_eq!(eol, LF, "state advances through the error");
    // Next write resumes from consistent state: "\r" after the failed "\n"
    // batch is still collapsed.
    let mut chunks: Vec<Vec<u16>> = Vec::new();
    let err = transform_units(&mut high, &mut eol, &[CR, b'z' as u16], &mut |c| {
        chunks.push(c.to_vec());
        Win32Error::SUCCESS
    });
    assert_eq!(err, Win32Error::SUCCESS);
    assert_eq!(chunks, vec![vec![b'z' as u16]]);
}

/// The read_stop wake record must carry a VALID EventType: zero is rejected
/// with ERROR_INVALID_PARAMETER on some Windows builds — and accepted on
/// others (including current Win11), so only this pin can hold the line
/// against the b9a08403 regression. // quirk: TTY-34
#[test]
fn raw_wake_record_kat() {
    let r = raw_wake_record();
    assert_eq!(r.EventType, bun_windows_sys::FOCUS_EVENT);
    assert_ne!(r.EventType, 0);
}

/// Mode flag sets are exact: NORMAL never touches insert/quick-edit (no
/// ENABLE_EXTENDED_FLAGS), RAW is window-input only, RAW_VT only *tries* the
/// VT flag. // quirk: TTY-43, TTY-44
#[test]
fn mode_flag_sets_kat() {
    assert_eq!(
        mode_flags(TtyMode::Normal),
        (
            ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT,
            0
        )
    );
    assert_eq!(mode_flags(TtyMode::Normal).0, 0x7);
    assert_eq!(mode_flags(TtyMode::Raw), (ENABLE_WINDOW_INPUT, 0));
    assert_eq!(mode_flags(TtyMode::Raw).0, 0x8);
    assert_eq!(
        mode_flags(TtyMode::RawVt),
        (ENABLE_WINDOW_INPUT, ENABLE_VIRTUAL_TERMINAL_INPUT)
    );
}

// ───────────────────── loop tests (no console required) ────────────────────

/// Non-console handles are rejected by the GetConsoleMode probe with the
/// probe's raw error, and the caller keeps ownership. // quirk: TTY-05
#[test]
fn open_rejects_non_console_handles() {
    let _guard = serial();
    let mut loop_ = Loop::new().unwrap();
    let lp: *mut Loop = &raw mut *loop_;

    // (a) anonymous pipe.
    let mut rh: HANDLE = ptr::null_mut();
    let mut wh: HANDLE = ptr::null_mut();
    // SAFETY: valid out-pointers; default security/size.
    let ok = unsafe { CreatePipe(&raw mut rh, &raw mut wh, ptr::null_mut(), 0) };
    assert_ne!(ok, 0);
    // SAFETY: loop valid; on error the caller retains ownership.
    let err = unsafe { TtyHandle::open(lp, rh) }.err();
    assert_eq!(err, Some(Win32Error::INVALID_HANDLE));
    // Ownership retained: closing both ends still succeeds.
    // SAFETY: the test owns both pipe ends.
    unsafe {
        assert_ne!(CloseHandle(rh), 0);
        assert_ne!(CloseHandle(wh), 0);
    }

    // (b) a disk file.
    let mut tmp = [0u16; 512];
    // SAFETY: valid out-buffer sized to the call (the extern misdeclares the
    // out param as LPCWSTR; pass a mut-derived ptr).
    let n = unsafe { bun_windows_sys::GetTempPathW(512, tmp.as_mut_ptr().cast_const()) } as usize;
    assert!(n > 0 && n < 480);
    let name: Vec<u16> = tmp[..n]
        .iter()
        .copied()
        .chain("bun-iocp-tty05.tmp".encode_utf16())
        .chain(core::iter::once(0))
        .collect();
    // SAFETY: NUL-terminated name; delete-on-close cleans up.
    let file = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            ptr::null_mut(),
            bun_windows_sys::CREATE_ALWAYS,
            bun_windows_sys::FILE_FLAG_DELETE_ON_CLOSE,
            ptr::null_mut(),
        )
    };
    assert_ne!(file, INVALID_HANDLE_VALUE);
    // SAFETY: loop valid; on error the caller retains ownership.
    let err = unsafe { TtyHandle::open(lp, file) }.err();
    assert_eq!(err, Some(Win32Error::INVALID_HANDLE));
    // SAFETY: the test owns `file`.
    unsafe { CloseHandle(file) };

    drop(loop_);
}

/// Process-global init contract, asserted in whichever branch this
/// environment provides: with a console attached, CONOUT$/CONIN$ are
/// captured and the size cache is primed; without one, the globals stay
/// absent and console-handle adoption fails with the probe error. Neither
/// branch is a silent skip — and the fixture child below always exercises
/// the console branch. // quirk: TTY-01, TTY-02
#[test]
fn console_global_state_probe() {
    // SAFETY: NUL-terminated static name.
    let probe = unsafe {
        CreateFileW(
            CONOUT_NAME.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    let has_console = probe != INVALID_HANDLE_VALUE;
    if has_console {
        // SAFETY: opened above.
        unsafe { CloseHandle(probe) };
    }

    console_init();

    if has_console {
        assert!(console_out().is_some(), "CONOUT$ must be captured");
        assert!(console_in().is_some(), "CONIN$ must be captured");
        assert_ne!(
            ORIGINAL_IN_MODE.load(Ordering::Acquire),
            u32::MAX,
            "original input mode must be snapshotted"
        );
        let state = lock_resize_state();
        assert!(state.width > 0 && state.height > 0, "size cache primed");
    } else {
        assert!(console_out().is_none());
        assert!(console_in().is_none());
        assert_eq!(ORIGINAL_IN_MODE.load(Ordering::Acquire), u32::MAX);
        // reset_mode without a console is a guaranteed no-op (no handle to
        // touch) — exercising the guard path.
        reset_mode();
    }
    // The output lock exists either way.
    assert!(handle_from_bits(OUTPUT_SEM.load(Ordering::Acquire)).is_some());
}

// ───────────────────── real-console fixture (child) ────────────────────────

struct FixCtx {
    bytes: Vec<u8>,
    utf16: Vec<u16>,
    read_errs: Vec<Win32Error>,
    writes: Vec<(usize, Win32Error)>,
    shutdowns: Vec<Win32Error>,
    order: Vec<&'static str>,
    closed: u32,
    stop_in_cb: bool,
    handle: *mut TtyHandle,
}

impl FixCtx {
    fn new() -> FixCtx {
        FixCtx {
            bytes: Vec::new(),
            utf16: Vec::new(),
            read_errs: Vec::new(),
            writes: Vec::new(),
            shutdowns: Vec::new(),
            order: Vec::new(),
            closed: 0,
            stop_in_cb: false,
            handle: ptr::null_mut(),
        }
    }
}

unsafe fn fix_on_read(_l: &mut Loop, d: *mut c_void, payload: TtyReadData, err: Win32Error) {
    // SAFETY: `d` is the fixture ctx; payloads are valid for the callback
    // duration per the read contract.
    unsafe {
        let ctx = &mut *d.cast::<FixCtx>();
        if err != Win32Error::SUCCESS {
            ctx.read_errs.push(err);
            return;
        }
        match payload {
            TtyReadData::Bytes { ptr: p, len } => {
                ctx.bytes
                    .extend_from_slice(core::slice::from_raw_parts(p, len));
            }
            TtyReadData::Utf16 { ptr: p, len } => {
                ctx.utf16
                    .extend_from_slice(core::slice::from_raw_parts(p, len));
            }
        }
        if ctx.stop_in_cb {
            ctx.stop_in_cb = false;
            let _ = (*ctx.handle).read_stop();
        }
    }
}

unsafe fn fix_on_write(_l: &mut Loop, d: *mut c_void, len: usize, err: Win32Error) {
    // SAFETY: `d` is the fixture ctx.
    unsafe {
        let ctx = &mut *d.cast::<FixCtx>();
        ctx.order.push("write");
        ctx.writes.push((len, err));
    }
}

unsafe fn fix_on_shutdown(_l: &mut Loop, d: *mut c_void, err: Win32Error) {
    // SAFETY: `d` is the fixture ctx.
    unsafe {
        let ctx = &mut *d.cast::<FixCtx>();
        ctx.order.push("shutdown");
        ctx.shutdowns.push(err);
    }
}

unsafe fn fix_on_close(_l: &mut Loop, d: *mut c_void) {
    // SAFETY: `d` is the fixture ctx.
    unsafe {
        let ctx = &mut *d.cast::<FixCtx>();
        ctx.order.push("close");
        ctx.closed += 1;
    }
}

static RESIZE_HITS: AtomicU32 = AtomicU32::new(0);
unsafe fn fix_on_resize() {
    RESIZE_HITS.fetch_add(1, Ordering::AcqRel);
}

fn fix_report(failures: &mut Vec<String>, name: &str, ok: bool, detail: &str) {
    // Direct io::stdout writes bypass libtest capture, reaching the parent's
    // pipe deterministically.
    let mut out = std::io::stdout().lock();
    if ok {
        let _ = writeln!(out, "TTYFIX OK {name}");
    } else {
        let _ = writeln!(out, "TTYFIX FAIL {name}: {detail}");
        failures.push(format!("{name}: {detail}"));
    }
    let _ = out.flush();
}

fn inject(conin: HANDLE, recs: &[INPUT_RECORD]) {
    let mut written: DWORD = 0;
    // SAFETY: records are valid locals; conin is a live console input handle.
    let ok =
        unsafe { WriteConsoleInputW(conin, recs.as_ptr(), recs.len() as DWORD, &raw mut written) };
    assert!(
        ok != 0 && written as usize == recs.len(),
        "WriteConsoleInputW"
    );
}

fn read_row(conout: HANDLE, row: i16, len: usize) -> String {
    let mut buf = vec![0u16; len];
    let mut read: DWORD = 0;
    // SAFETY: valid out-buffer; conout is a live screen-buffer handle.
    let ok = unsafe {
        ReadConsoleOutputCharacterW(
            conout,
            buf.as_mut_ptr(),
            len as DWORD,
            COORD { X: 0, Y: row },
            &raw mut read,
        )
    };
    assert_ne!(ok, 0, "ReadConsoleOutputCharacterW");
    String::from_utf16_lossy(&buf[..read as usize])
}

fn screen_info(conout: HANDLE) -> CONSOLE_SCREEN_BUFFER_INFO {
    let mut info = zero_screen_info();
    // SAFETY: valid out-pointer on a live screen-buffer handle.
    let ok = unsafe { GetConsoleScreenBufferInfo(conout, &raw mut info) };
    assert_ne!(ok, 0, "GetConsoleScreenBufferInfo");
    info
}

fn in_mode(conin: HANDLE) -> DWORD {
    let mut m: DWORD = 0;
    // SAFETY: valid out-pointer on a live console input handle.
    let ok = unsafe { GetConsoleMode(conin, &raw mut m) };
    assert_ne!(ok, 0, "GetConsoleMode(conin)");
    m
}

fn tick_until(loop_: &mut Loop, budget_ms: u64, cond: &mut dyn FnMut() -> bool) -> bool {
    let deadline = loop_.now_ms() + budget_ms;
    while !cond() {
        if loop_.now_ms() >= deadline {
            return false;
        }
        loop_.tick(Some(25));
    }
    true
}

/// Per-phase budget. Debug builds + pool-thread spin-up are slow; every wait
/// below is bounded by this (a hang fails the phase, never the harness).
const PHASE_MS: u64 = 20_000;

/// The real-console suite. Runs in a CREATE_NEW_CONSOLE child spawned by
/// `console_fixture_suite`; every check emits an explicit TTYFIX marker the
/// parent asserts on.
#[test]
#[ignore = "console fixture: executed in a CREATE_NEW_CONSOLE child by console_fixture_suite"]
fn console_fixture() {
    let mut failures: Vec<String> = Vec::new();
    macro_rules! check {
        ($name:expr, $cond:expr) => {
            fix_report(&mut failures, $name, $cond, &format!("at line {}", line!()))
        };
        ($name:expr, $cond:expr, $detail:expr) => {
            fix_report(&mut failures, $name, $cond, &$detail)
        };
    }

    // 0. A console must exist; CREATE_NEW_CONSOLE provides one, AllocConsole
    //    is the fallback for exotic runners. This is asserted, not skipped.
    // SAFETY: NUL-terminated static names; handles owned by the fixture.
    let (conout_raw, conin_raw) = unsafe {
        let mut conout = CreateFileW(
            CONOUT_NAME.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );
        if conout == INVALID_HANDLE_VALUE {
            AllocConsole();
            conout = CreateFileW(
                CONOUT_NAME.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            );
        }
        let conin = CreateFileW(
            CONIN_NAME.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            ptr::null_mut(),
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        );
        (conout, conin)
    };
    check!(
        "console-available",
        conout_raw != INVALID_HANDLE_VALUE && conin_raw != INVALID_HANDLE_VALUE
    );
    assert!(
        failures.is_empty(),
        "no console in fixture child: {failures:?}"
    );
    // SAFETY: live console input handle.
    unsafe { FlushConsoleInputBuffer(conin_raw) };
    let startup_in_mode = in_mode(conin_raw);

    // Make the screen buffer taller than the window so window-height vs
    // buffer-height is distinguishable. // quirk: TTY-48
    let pre = screen_info(conout_raw);
    let window_h = i32::from(pre.srWindow.Bottom) - i32::from(pre.srWindow.Top) + 1;
    // SAFETY: by-value COORD on a live screen-buffer handle.
    unsafe {
        SetConsoleScreenBufferSize(
            conout_raw,
            COORD {
                X: pre.dwSize.X,
                Y: (window_h as i16) + 50,
            },
        )
    };

    // 1. Process-global init captured the original mode and size.
    console_init();
    check!(
        "init-captured-original-mode",
        ORIGINAL_IN_MODE.load(Ordering::Acquire) == startup_in_mode,
        format!(
            "captured {:#x} vs startup {startup_in_mode:#x}",
            ORIGINAL_IN_MODE.load(Ordering::Acquire)
        )
    );
    {
        let s = lock_resize_state();
        check!("init-cached-size", s.width > 0 && s.height > 0);
    }
    // reset_mode is a no-op while unarmed. // quirk: TTY-44
    reset_mode();
    check!("reset-unarmed-noop", in_mode(conin_raw) == startup_in_mode);

    let mut loop_ = Loop::new().unwrap();
    let lp: *mut Loop = &raw mut *loop_;

    // 2. Open both directions; direction is probed, never trusted.
    // SAFETY: loop and raw handles outlive the ttys; open duplicates.
    let mut tin = unsafe { TtyHandle::open(lp, conin_raw) }.expect("open conin tty");
    // SAFETY: as above.
    let mut tout = unsafe { TtyHandle::open(lp, conout_raw) }.expect("open conout tty");
    check!(
        "open-directions",
        tin.is_readable() && !tin.is_writable() && !tout.is_readable() && tout.is_writable()
    );
    // The VT probe ran on the first output tty and left the flag enabled.
    // // quirk: TTY-08
    let mut out_mode: DWORD = 0;
    // SAFETY: valid out-pointer on the live screen-buffer handle.
    unsafe { GetConsoleMode(conout_raw, &raw mut out_mode) };
    check!(
        "vt-probe-enabled",
        out_mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING != 0 && vterm_supported(),
        format!("conout mode {out_mode:#x}")
    );

    // 3. Winsize: width from the buffer, height from the window.
    let info = screen_info(conout_raw);
    let (w, h) = tout.get_winsize().expect("get_winsize(conout)");
    check!(
        "winsize-window-height",
        w == i32::from(info.dwSize.X)
            && h == i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1
            && h < i32::from(info.dwSize.Y),
        format!("w={w} h={h} buffer={}x{}", info.dwSize.X, info.dwSize.Y)
    );
    check!("winsize-input-rejected", tin.get_winsize().is_err());

    let mut ctx = Box::new(FixCtx::new());
    let cd: *mut c_void = (&raw mut *ctx).cast();

    // 4. Write path: synchronous on the loop thread, callback deferred.
    let hello: Vec<u16> = "hello\nworld".encode_utf16().collect();
    // SAFETY: ctx outlives the loop drains.
    unsafe { tout.write(&hello, Some(fix_on_write), cd) }.expect("write hello");
    // The bytes hit the console BEFORE any tick (synchronous write)…
    check!("write-sync-content", read_row(conout_raw, 0, 5) == "hello");
    // …but the callback is deferred. // quirk: TTY-24
    check!("write-deferred-cb", ctx.writes.is_empty());
    let got = tick_until(&mut loop_, PHASE_MS, &mut || !ctx.writes.is_empty());
    check!(
        "write-cb-fired",
        got && ctx.writes == vec![(hello.len(), Win32Error::SUCCESS)],
        format!("{:?}", ctx.writes)
    );
    // \n became \r\n: "world" starts at column 0 of row 1. // quirk: TTY-16
    check!(
        "write-eol-rows",
        read_row(conout_raw, 1, 5) == "world",
        format!("row1={:?}", read_row(conout_raw, 1, 5))
    );

    // Cross-write EOL state lives on the handle: "a\n" then "\rX" swallows
    // the \r. // quirk: TTY-16
    let a_nl: Vec<u16> = "a\n".encode_utf16().collect();
    // SAFETY: ctx outlives the drains.
    unsafe { tout.write(&a_nl, Some(fix_on_write), cd) }.expect("write a\\n");
    check!("write-cross-eol-state", tout.previous_eol == LF);
    // Lone \r returns to column 0 (progress-bar contract): "zz" then "\rY"
    // overwrites the z at column 0 of the same row. // quirk: TTY-16
    let row_now = screen_info(conout_raw).dwCursorPosition.Y;
    let zz: Vec<u16> = "zz".encode_utf16().collect();
    let cr_y: Vec<u16> = "\rY".encode_utf16().collect();
    // SAFETY: ctx outlives the drains.
    unsafe {
        tout.write(&zz, Some(fix_on_write), cd).expect("write zz");
        tout.write(&cr_y, Some(fix_on_write), cd)
            .expect("write \\rY");
    }
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.writes.len() >= 4);
    check!(
        "write-lone-cr-overwrite",
        got && read_row(conout_raw, row_now, 2) == "Yz",
        format!("row={:?}", read_row(conout_raw, row_now, 2))
    );

    // Surrogate handling through the real console: a pair writes fine; a
    // split pair is held across calls and joined. // quirk: TTY-12, TTY-13
    // SAFETY: ctx outlives the drains.
    unsafe {
        tout.write(&[0xD83D, 0xDE00], Some(fix_on_write), cd)
            .expect("write pair");
        tout.write(&[0xD83D], Some(fix_on_write), cd)
            .expect("write high");
    }
    let held = tout.pending_high_surrogate;
    // SAFETY: ctx outlives the drains.
    unsafe { tout.write(&[0xDE00], Some(fix_on_write), cd) }.expect("write low");
    check!(
        "write-surrogate-hold",
        held == 0xD83D && tout.pending_high_surrogate == 0
    );
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.writes.len() >= 7);
    check!(
        "write-surrogate-cbs",
        got && ctx.writes[4..]
            .iter()
            .all(|&(_, e)| e == Win32Error::SUCCESS),
        format!("{:?}", &ctx.writes)
    );

    // try_write is gated on pending write completions. // quirk: TTY-24
    let q: Vec<u16> = "q".encode_utf16().collect();
    // SAFETY: ctx outlives the drains.
    unsafe { tout.write(&q, Some(fix_on_write), cd) }.expect("write q");
    check!(
        "try-write-gate",
        tout.try_write(&q) == Err(Win32Error::WSAEWOULDBLOCK)
    );
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.writes.len() >= 8);
    check!("try-write-after-drain", got && tout.try_write(&q) == Ok(1));

    // Shutdown settles after queued writes; later writes are rejected.
    // // quirk: TTY-47
    let r: Vec<u16> = "r".encode_utf16().collect();
    // SAFETY: ctx outlives the drains.
    unsafe {
        tout.write(&r, Some(fix_on_write), cd).expect("write r");
        tout.shutdown(Some(fix_on_shutdown), cd).expect("shutdown");
    }
    // SAFETY: ctx outlives any (rejected) write attempt.
    let rejected = unsafe { tout.write(&r, Some(fix_on_write), cd) };
    check!(
        "write-after-shutdown-rejected",
        rejected.err() == Some(Win32Error::NO_DATA)
    );
    let got = tick_until(&mut loop_, PHASE_MS, &mut || !ctx.shutdowns.is_empty());
    let widx = ctx.order.iter().rposition(|s| *s == "write");
    let sidx = ctx.order.iter().position(|s| *s == "shutdown");
    check!(
        "shutdown-after-writes",
        got && ctx.shutdowns == vec![Win32Error::SUCCESS]
            && widx.is_some()
            && sidx.is_some()
            && widx.unwrap() < sidx.unwrap(),
        format!("{:?}", ctx.order)
    );

    // 5. Raw mode + flag discipline. // quirk: TTY-42, TTY-43, TTY-45
    check!(
        "mode-output-rejected",
        tout.set_mode(TtyMode::Raw) == Err(Win32Error::INVALID_PARAMETER)
    );
    tin.set_mode(TtyMode::Raw).expect("set_mode raw");
    let m = in_mode(conin_raw);
    check!(
        "mode-raw-flags",
        m == ENABLE_WINDOW_INPUT,
        format!("mode {m:#x}")
    );
    // Quick-edit preservation is NOT observable through GetConsoleMode here:
    // conhost hides INSERT/QUICK_EDIT from the readback unless
    // ENABLE_EXTENDED_FLAGS is stored — which is exactly what we must never
    // store. The discriminator for the node#4809 regression (NORMAL setting
    // EXTENDED|INSERT and thereby stomping the user's quick-edit) is the
    // exact-mode equality above/below: no extended bits ever appear, so
    // conhost keeps the user's preference; the reset path then proves the
    // original mode (extended bits included) comes back intact.
    // // quirk: TTY-43
    check!(
        "mode-quickedit-preserved",
        m & (ENABLE_QUICK_EDIT_MODE
            | bun_windows_sys::ENABLE_EXTENDED_FLAGS
            | bun_windows_sys::ENABLE_INSERT_MODE)
            == 0,
        format!("mode {m:#x} startup {startup_in_mode:#x}")
    );

    // 6. Raw read end-to-end: inject, translate, deliver.
    let mut rbuf = vec![0u8; 64];
    ctx.handle = &raw mut *tin;
    // SAFETY: rbuf/ctx outlive the reads.
    unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
        .expect("read_start raw");
    inject(
        conin_raw,
        &[
            key_rec(true, 0x41, b'a' as u16, 0, 1),
            key_rec(false, 0x41, b'a' as u16, 0, 1),
            key_rec(true, VK_UP, 0, ENHANCED_KEY, 1),
            key_rec(false, VK_UP, 0, ENHANCED_KEY, 1),
            key_rec(true, 0x42, b'b' as u16, 0, 2),
            key_rec(false, 0x42, b'b' as u16, 0, 1),
            key_rec(true, 0, 0xD83D, 0, 1),
            key_rec(true, 0, 0xDE00, 0, 1),
            key_rec(false, VK_MENU, 0xE9, 0, 1),
        ],
    );
    let mut expected: Vec<u8> = Vec::new();
    expected.extend_from_slice(b"a\x1b[Abb");
    expected.extend_from_slice(&[0xF0, 0x9F, 0x98, 0x80, 0xC3, 0xA9]);
    let got = tick_until(&mut loop_, PHASE_MS, &mut || {
        ctx.bytes.len() >= expected.len()
    });
    check!(
        "raw-translate-bytes",
        got && ctx.bytes == expected,
        format!("{:x?} vs {:x?}", ctx.bytes, expected)
    );

    // read_stop wakes the wait via FOCUS_EVENT and no callback fires while
    // stopped; records queued meanwhile survive for the next start.
    // // quirk: TTY-34
    ctx.bytes.clear();
    check!("raw-stop-ok", tin.read_stop().is_ok());
    inject(conin_raw, &[key_rec(true, 0x58, b'X' as u16, 0, 1)]);
    // Bounded no-delivery window.
    let fired = tick_until(&mut loop_, 400, &mut || !ctx.bytes.is_empty());
    check!("raw-stop-no-cb", !fired, format!("{:x?}", ctx.bytes));
    // SAFETY: rbuf/ctx still valid.
    unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
        .expect("read_start resume");
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.bytes == b"X");
    check!("raw-resume-delivers", got, format!("{:x?}", ctx.bytes));

    // Partial-key carryover: a 2-byte buffer splits \x1b[A; stopping from
    // inside the callback parks the tail; the next read_start short-circuits
    // without touching the console. // quirk: TTY-33
    ctx.bytes.clear();
    tin.read_stop().expect("read_stop");
    // Await the poked wait's completion drain (the real condition).
    let drained = tick_until(&mut loop_, PHASE_MS, &mut || !tin.read_pending);
    check!("raw-stop-wake-drained", drained);
    let mut small = vec![0u8; 2];
    ctx.stop_in_cb = true;
    inject(conin_raw, &[key_rec(true, VK_UP, 0, ENHANCED_KEY, 1)]);
    // SAFETY: small/ctx outlive the reads.
    unsafe { tin.read_start(small.as_mut_ptr(), small.len(), fix_on_read, cd) }
        .expect("read_start small");
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.bytes.len() >= 2);
    let parked = tin.raw.has_bytes();
    check!(
        "carryover-parks-tail",
        got && parked && ctx.bytes == b"\x1b[",
        format!("parked={parked} bytes={:x?}", ctx.bytes)
    );
    // SAFETY: small/ctx still valid.
    unsafe { tin.read_start(small.as_mut_ptr(), small.len(), fix_on_read, cd) }
        .expect("read_start short-circuit");
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.bytes.len() >= 3);
    check!(
        "carryover-short-circuit",
        got && ctx.bytes == b"\x1b[A",
        format!("{:x?}", ctx.bytes)
    );

    // Resize fallback: a WINDOW_BUFFER_SIZE_EVENT record in the raw stream
    // dispatches the resize callback. // quirk: TTY-50, TTY-51, TTY-52
    set_resize_callback(Some(fix_on_resize));
    let before_hits = RESIZE_HITS.load(Ordering::Acquire);
    let cur = screen_info(conout_raw);
    // SAFETY: by-value COORD; widening the buffer posts the record.
    unsafe {
        SetConsoleScreenBufferSize(
            conout_raw,
            COORD {
                X: cur.dwSize.X + 1,
                Y: cur.dwSize.Y,
            },
        )
    };
    let got = tick_until(&mut loop_, PHASE_MS, &mut || {
        RESIZE_HITS.load(Ordering::Acquire) > before_hits
    });
    check!("resize-record-dispatch", got);
    tin.read_stop().expect("read_stop after resize");
    let drained = tick_until(&mut loop_, PHASE_MS, &mut || !tin.read_pending);
    check!("resize-stop-drained", drained);

    // 7. Cooked mode + the cancel handshake.
    tin.set_mode(TtyMode::Normal).expect("set_mode normal");
    let m = in_mode(conin_raw);
    // Exact equality: NORMAL stores precisely ECHO|LINE|PROCESSED — no
    // extended/insert/quick-edit bits (node#4809 shape). // quirk: TTY-43
    check!(
        "mode-normal-flags",
        m == ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT,
        format!("mode {m:#x}")
    );
    check!("mode-dedupe", tin.set_mode(TtyMode::Normal).is_ok());

    // SAFETY: live console input handle (clean slate for the cooked read).
    unsafe { FlushConsoleInputBuffer(conin_raw) };
    ctx.bytes.clear();
    ctx.utf16.clear();

    for cycle in 0..2u32 {
        // Two full park/cancel cycles: the second deadlocks if the worker's
        // early-trap path forgets the COMPLETED transition (node#32999).
        // // quirk: TTY-39
        let cursor_before = screen_info(conout_raw).dwCursorPosition;
        // SAFETY: rbuf/ctx outlive the reads.
        unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
            .expect("read_start line");
        // Bias toward the worker reaching ReadConsoleW by awaiting the
        // observable IN_PROGRESS transition — bounded and non-asserted,
        // because either interleaving must pass the checks below.
        let _ = tick_until(&mut loop_, 500, &mut || {
            READ_CONSOLE_STATUS.load(Ordering::Acquire) == READ_IN_PROGRESS
        });
        let fired = tick_until(&mut loop_, 200, &mut || {
            !ctx.utf16.is_empty() || !ctx.read_errs.is_empty()
        });
        if cycle == 0 {
            check!("line-blocked-no-cb", !fired);
        }
        tin.read_stop().expect("read_stop line");
        let got = tick_until(&mut loop_, PHASE_MS, &mut || !tin.read_pending);
        check!(
            if cycle == 0 {
                "line-cancel-drained"
            } else {
                "line-second-cycle"
            },
            got
        );
        if cycle == 0 {
            // The cancelled read's data is silently discarded; no zero-unit
            // callback either. // quirk: TTY-40
            check!(
                "line-cancel-discard",
                ctx.utf16.is_empty() && ctx.read_errs.is_empty(),
                format!("utf16={:?} errs={:?}", ctx.utf16, ctx.read_errs)
            );
            check!(
                "line-cancel-status-completed",
                READ_CONSOLE_STATUS.load(Ordering::Acquire) == READ_COMPLETED
            );
            // The reader released the output lock the canceller acquired.
            // // quirk: TTY-39, TTY-10
            let sem = handle_from_bits(OUTPUT_SEM.load(Ordering::Acquire)).unwrap();
            // SAFETY: process-lifetime semaphore handle.
            let acq = unsafe { WaitForSingleObject(sem, 5_000) };
            let lock_free = acq.ok() == Some(WAIT_OBJECT_0);
            if lock_free {
                output_lock_release();
            }
            check!("line-cancel-lock-released", lock_free);
            // The phantom newline from the injected VK_RETURN was erased.
            // // quirk: TTY-38
            let cursor_after = screen_info(conout_raw).dwCursorPosition;
            check!(
                "line-cancel-cursor-restored",
                cursor_after.X == cursor_before.X && cursor_after.Y == cursor_before.Y,
                format!(
                    "before=({},{}) after=({},{})",
                    cursor_before.X, cursor_before.Y, cursor_after.X, cursor_after.Y
                )
            );
        }
    }

    // Pre-empt cycles: read_stop immediately after read_start usually lands
    // the trap BEFORE the pool worker reaches ReadConsoleW, exercising the
    // early-trap path — whose COMPLETED transition is the node#32999
    // deadlock fix. Every drained cycle must end COMPLETED regardless of
    // which interleaving occurred. // quirk: TTY-39
    let mut preempt_ok = true;
    for _ in 0..5 {
        // SAFETY: rbuf/ctx outlive the reads.
        unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
            .expect("read_start preempt");
        tin.read_stop().expect("read_stop preempt");
        let drained = tick_until(&mut loop_, PHASE_MS, &mut || !tin.read_pending);
        let completed = READ_CONSOLE_STATUS.load(Ordering::Acquire) == READ_COMPLETED;
        preempt_ok &= drained && completed;
    }
    check!("line-preempt-status-completed", preempt_ok);

    // Real cooked delivery: injected keystrokes complete the line and arrive
    // as UTF-16, with the \r\n cooked mode appends. // quirk: TTY-35
    ctx.utf16.clear();
    // SAFETY: rbuf/ctx outlive the reads.
    unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
        .expect("read_start cooked");
    inject(
        conin_raw,
        &[
            key_rec(true, 0x48, b'h' as u16, 0, 1),
            key_rec(false, 0x48, b'h' as u16, 0, 1),
            key_rec(true, 0x49, b'i' as u16, 0, 1),
            key_rec(false, 0x49, b'i' as u16, 0, 1),
            key_rec(true, VK_RETURN, b'\r' as u16, 0, 1),
            key_rec(false, VK_RETURN, b'\r' as u16, 0, 1),
        ],
    );
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.utf16.len() >= 4);
    let expected_units: Vec<u16> = "hi\r\n".encode_utf16().collect();
    check!(
        "line-cooked-delivery",
        got && ctx.utf16 == expected_units,
        format!("{:x?}", ctx.utf16)
    );

    // Mode switch while reading: stop → SetConsoleMode → restart, ending in
    // a working raw read. // quirk: TTY-42
    ctx.bytes.clear();
    // SAFETY: rbuf/ctx outlive the reads.
    unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
        .expect("read_start pre-switch");
    // Bias toward a parked worker (bounded, non-asserted: TTY-42's ordering
    // must hold in either interleaving).
    let _ = tick_until(&mut loop_, 500, &mut || {
        READ_CONSOLE_STATUS.load(Ordering::Acquire) == READ_IN_PROGRESS
    });
    tin.set_mode(TtyMode::Raw)
        .expect("set_mode raw while reading");
    inject(
        conin_raw,
        &[
            key_rec(true, 0x5A, b'z' as u16, 0, 1),
            key_rec(false, 0x5A, b'z' as u16, 0, 1),
        ],
    );
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.bytes == b"z");
    check!(
        "mode-switch-while-reading",
        got,
        format!("{:x?}", ctx.bytes)
    );
    tin.read_stop().expect("read_stop post-switch");
    let drained = tick_until(&mut loop_, PHASE_MS, &mut || !tin.read_pending);
    check!("post-switch-stop-drained", drained);

    // 8. RAW_VT: VT input flag attempted, reset armed, reset restores the
    //    startup mode. // quirk: TTY-44
    tin.set_mode(TtyMode::RawVt).expect("set_mode rawvt");
    let m = in_mode(conin_raw);
    check!(
        "rawvt-armed",
        NEED_MODE_RESET.load(Ordering::Acquire) && tin.mode() == TtyMode::RawVt,
        format!("mode {m:#x}")
    );
    check!(
        "rawvt-flag-or-degrade",
        m & ENABLE_WINDOW_INPUT != 0,
        format!(
            "mode {m:#x} (vt-input bit: {})",
            m & ENABLE_VIRTUAL_TERMINAL_INPUT != 0
        )
    );
    reset_mode();
    check!(
        "rawvt-reset-restores",
        in_mode(conin_raw) == startup_in_mode && !NEED_MODE_RESET.load(Ordering::Acquire),
        format!(
            "mode {:#x} vs startup {startup_in_mode:#x}",
            in_mode(conin_raw)
        )
    );

    // 9. Close discipline: a registered raw wait is retired through the
    //    poke → post → dispatch path before the endgame. // quirk: TTY-06, TTY-46
    // SAFETY: rbuf/ctx outlive the close drain.
    unsafe { tin.read_start(rbuf.as_mut_ptr(), rbuf.len(), fix_on_read, cd) }
        .expect("read_start pre-close");
    tin.close(Some(fix_on_close), cd);
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.closed >= 1);
    check!(
        "close-input-clean",
        got && tin.read_raw_wait.is_null() && tin.line_work.is_null(),
        format!("closed={}", ctx.closed)
    );

    // Output close with a write still queued: the write callback fires, then
    // the close callback. `tout` is already shut down (writes rejected), so
    // a fresh output tty exercises this path.
    // SAFETY: loop and conout_raw outlive the tty; open duplicates.
    let mut tout2 = unsafe { TtyHandle::open(lp, conout_raw) }.expect("open conout tty #2");
    let fin: Vec<u16> = "bye".encode_utf16().collect();
    let order_base = ctx.order.len();
    // SAFETY: ctx outlives the close drain; tout2 pinned until close cb.
    unsafe { tout2.write(&fin, Some(fix_on_write), cd) }.expect("final write");
    tout2.close(Some(fix_on_close), cd);
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.closed >= 2);
    let tail = &ctx.order[order_base..];
    check!(
        "close-write-then-close-order",
        got && tail.first() == Some(&"write") && tail.last() == Some(&"close"),
        format!("{tail:?}")
    );

    // The original (shutdown-Done) output tty closes cleanly too.
    tout.close(Some(fix_on_close), cd);
    let got = tick_until(&mut loop_, PHASE_MS, &mut || ctx.closed >= 3);
    check!("close-after-shutdown", got);

    check!("loop-idle-after-close", !loop_.alive());
    drop(tin);
    drop(tout);
    drop(tout2);
    drop(loop_);

    // SAFETY: fixture-owned raw console handles.
    unsafe {
        CloseHandle(conin_raw);
        CloseHandle(conout_raw);
    }

    let ok_count = {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "TTYFIX DONE failures={}", failures.len());
        let _ = out.flush();
        failures.len()
    };
    assert!(ok_count == 0, "fixture failures: {failures:?}");
}

// ───────────────────── fixture spawner (parent) ────────────────────────────

/// Spawns the test binary into a FRESH console (CREATE_NEW_CONSOLE) and
/// asserts the fixture's explicit markers. This is how the real-console
/// suite always runs with a console, regardless of how the harness itself
/// was started — never a silent skip.
#[test]
fn console_fixture_suite() {
    let exe = std::env::current_exe().expect("current_exe");
    // std::process::Command: this tier-0 crate cannot depend on
    // bun_spawn_sys (it would break the natively-linkable test binary), and
    // the child is our own test executable.
    #[allow(clippy::disallowed_types)]
    let mut cmd = std::process::Command::new(exe);
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.args([
            "--ignored",
            "--exact",
            "tty::tests::console_fixture",
            "--nocapture",
            "--test-threads=1",
        ])
        .creation_flags(CREATE_NEW_CONSOLE)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    }
    let mut child = cmd.spawn().expect("spawn console fixture child");

    // Drain both pipes concurrently with the wait so a verbose fixture cannot
    // fill the anonymous-pipe buffer and deadlock on write before exiting.
    use std::io::Read as _;
    let out_pipe = child.stdout.take();
    let err_pipe = child.stderr.take();
    let out_th = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut p) = out_pipe {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    let err_th = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut p) = err_pipe {
            let _ = p.read_to_string(&mut s);
        }
        s
    });

    // Bounded wait: a deadlocked fixture must fail, not hang the suite.
    let start = std::time::Instant::now();
    let status = loop {
        match child.try_wait().expect("try_wait") {
            Some(st) => break st,
            None => {
                if start.elapsed() > std::time::Duration::from_secs(240) {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("console fixture child timed out (>240s)");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    };
    let stdout = out_th.join().unwrap_or_default();
    let stderr = err_th.join().unwrap_or_default();

    let fails: Vec<&str> = stdout
        .lines()
        .filter(|l| l.starts_with("TTYFIX FAIL"))
        .collect();
    assert!(
        fails.is_empty(),
        "fixture reported failures: {fails:#?}\n--- child stderr ---\n{stderr}"
    );
    assert!(
        stdout.contains("TTYFIX DONE failures=0"),
        "fixture did not complete\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
    );
    // Load-bearing markers, spot-asserted so a vanished check cannot pass
    // unnoticed (each is a mutation target).
    for marker in [
        "open-directions",
        "vt-probe-enabled",
        "winsize-window-height",
        "winsize-input-rejected",
        "write-deferred-cb",
        "write-sync-content",
        "write-eol-rows",
        "write-lone-cr-overwrite",
        "write-cross-eol-state",
        "write-surrogate-hold",
        "try-write-gate",
        "shutdown-after-writes",
        "write-after-shutdown-rejected",
        "mode-raw-flags",
        "mode-quickedit-preserved",
        "mode-output-rejected",
        "raw-translate-bytes",
        "raw-stop-no-cb",
        "raw-stop-wake-drained",
        "raw-resume-delivers",
        "carryover-parks-tail",
        "carryover-short-circuit",
        "resize-record-dispatch",
        "resize-stop-drained",
        "post-switch-stop-drained",
        "mode-normal-flags",
        "line-blocked-no-cb",
        "line-cancel-discard",
        "line-cancel-status-completed",
        "line-cancel-lock-released",
        "line-cancel-cursor-restored",
        "line-second-cycle",
        "line-preempt-status-completed",
        "line-cooked-delivery",
        "mode-switch-while-reading",
        "rawvt-armed",
        "rawvt-reset-restores",
        "reset-unarmed-noop",
        "close-input-clean",
        "close-write-then-close-order",
        "loop-idle-after-close",
        "init-captured-original-mode",
    ] {
        assert!(
            stdout.contains(&format!("TTYFIX OK {marker}")),
            "missing fixture marker {marker:?}\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
        );
    }
    assert!(
        status.success(),
        "fixture child exited with {status:?}\n--- child stdout ---\n{stdout}\n--- child stderr ---\n{stderr}"
    );
}
