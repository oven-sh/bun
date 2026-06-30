# libuv Windows institutional knowledge — TTY (src/win/tty.c)

Source worktree: C:/Users/dylan/code/libuv-read @ 439a54be (file is 2461 lines).
All line refs are `src/win/tty.c:<line>` unless another file is named.
Bun baseline: Windows 10 1809+ (so ENABLE_VIRTUAL_TERMINAL_PROCESSING/INPUT always *exist*; they can still be *rejected* — see TTY-08).

---

### [TTY-01] Open CONOUT$/CONIN$ once at process init; capture original input mode and initial size
- **What Windows does**: The console is process-global, not per-fd. The active screen buffer is reachable via the magic device name `CONOUT$`, input via `CONIN$`, regardless of what stdio fds point at. Input-mode flags set by a program persist after it exits (the console object is shared with the parent shell).
- **How libuv handles it**: `uv__console_init()` (tty.c:167-202), called from process-wide `uv__once_init()` (src/win/core.c:217), opens `CONOUT$` with GENERIC_READ|GENERIC_WRITE + FILE_SHARE_WRITE and `CONIN$` with GENERIC_READ|GENERIC_WRITE + FILE_SHARE_READ, snapshots the screen-buffer size, and snapshots the *original input console mode* (`uv__tty_console_in_original_mode`, tty.c:197-201) so it can be restored at exit (TTY-44). Both opens are best-effort: a GUI/detached process simply has no console. Note: failure check must be `!= INVALID_HANDLE_VALUE`, NOT `!= NULL` — CreateFileW returns INVALID_HANDLE_VALUE on failure (bug fixed in ec10a787, libuv#2141).
- **History**: 843b64fa (CONIN$ + original-mode capture, 2025); ec10a787 (INVALID_HANDLE_VALUE check, 2019); fe184384 (original uv_tty_reset_mode, 2011).
- **Bun disposition**: must-port. A Bun-native console layer needs exactly one process-wide init that snapshots original input mode before anything mutates it. Target: win tty init.

### [TTY-02] Capture console width/height BEFORE spawning the resize thread
- **What Windows does**: A resize event can be delivered the instant a listener exists; threads spawned via QueueUserWorkItem can run before the spawning function's next statement.
- **How libuv handles it**: In `uv__console_init` the initial `uv__tty_console_width/height` are read from GetConsoleScreenBufferInfo *before* `QueueUserWorkItem(uv__tty_console_resize_message_loop_thread)` (tty.c:180-188). Two separate bugs forced this ordering: (1) a WINDOW_BUFFER_SIZE_EVENT arriving before the cached size was initialized caused a spurious SIGWINCH at startup (neovim repro); (2) the resize thread racing `uv_mutex_init` / the size capture tripped an assert.
- **History**: 50130422 (libuv#2478, neovim/neovim#10978 — move capture into console_init); c51522c0 (libuv#3970 — mutex init + capture before QueueUserWorkItem, removed the now-impossible assert).
- **Bun disposition**: must-port (init-order constraint; trivially easy to get wrong again). Target: win tty resize.

### [TTY-03] fd 0-2: duplicate the OS handle and forget the fd
- **What Windows does**: Cancelling a blocked console read requires being able to close/operate on the handle without nuking the process's stdio. Closing fd 0/1/2 (or their underlying handle) breaks the whole process and any CRT users.
- **How libuv handles it**: `uv_tty_init` (tty.c:218-234): for `fd <= 2`, DuplicateHandle(SAME_ACCESS) and set `fd = -1`; the tty then owns a private handle it may freely CloseHandle at close time. The comment spells out the rationale: "We could also opt to use the original OS handle and just never close it, but then there would be no reliable way to cancel pending read operations upon close." For fd > 2 the original handle is kept and close goes through `_close(fd)` (TTY-06).
- **History**: f6fc5dd5 + 164fbda6 + 0bad50a0 (libuv#396, 2015 — a trilogy: don't close fd 0-2; close CRT-born handles with _close; convert fd safely).
- **Bun disposition**: must-port. Bun's tty open path must duplicate stdio handles for the same cancellation reason (the VK_RETURN/FOCUS_EVENT wakes in TTY-30/34 act on the handle). Target: win tty init.

### [TTY-04] Convert fd→HANDLE with a guarded _get_osfhandle
- **What Windows does**: `_get_osfhandle()` on an invalid/closed fd triggers the CRT invalid-parameter handler, which in debug CRTs aborts the process instead of returning -1.
- **How libuv handles it**: `uv__get_osfhandle` wrapper (used at tty.c:214) suppresses the invalid parameter handler and returns INVALID_HANDLE_VALUE → UV_EBADF.
- **History**: 0bad50a0 (libuv#396).
- **Bun disposition**: must-port (cross-ref: FS/handle area — Bun's fd layer already needs this everywhere it accepts CRT fds). Target: win sys fd.

### [TTY-05] Autodetect read vs write direction with GetNumberOfConsoleInputEvents
- **What Windows does**: There is no single "is this readable or writable" query; a console *input* handle answers GetNumberOfConsoleInputEvents, a *screen buffer* handle answers GetConsoleScreenBufferInfo. The two APIs fail on the wrong kind.
- **How libuv handles it**: tty.c:236 — `readable = GetNumberOfConsoleInputEvents(handle, &n)`; the legacy `readable` parameter of uv_tty_init is ignored entirely. Output handles must then pass GetConsoleScreenBufferInfo + GetConsoleCursorInfo or init fails with the translated error (tty.c:237-246). Companion: `uv_guess_handle` calls GetFileType==FILE_TYPE_CHAR then GetConsoleMode to distinguish TTY from `NUL`/other char devices (src/win/handle.c:31-58).
- **History**: 40498795 (libuv#1936/#1964, 2018 — users kept passing the wrong flag).
- **Bun disposition**: must-port (probe, not trust caller); cross-ref: STREAM/handle-detect. Target: win tty init.

### [TTY-06] Close path: CloseHandle vs _close, and stop reads BEFORE closing
- **What Windows does**: A handle born from a CRT fd must be released via `_close(fd)` (else the CRT fd leaks/double-frees); a duplicated raw handle via CloseHandle. Cancelling pending console reads (WriteConsoleInputW wake events) requires the handle to still be open.
- **How libuv handles it**: `uv__tty_close` (tty.c:2270-2287): asserts `fd == -1 || fd > 2`, calls `uv__tty_read_stop` FIRST (while the handle is valid), then CloseHandle (fd==-1) or `_close(fd)`. The original order (close, then read_stop) left ReadConsole threads blocked forever → process hang at exit (node#22999).
- **History**: 164fbda6 (close with _close); ee87f344 (libuv#2005 — reorder: stop reads before close).
- **Bun disposition**: must-port (ordering constraint; hang class). Target: win tty close.

### [TTY-07] Readable tty handles must NOT touch the output/virtual-window state (reverted experiment)
- **What Windows does**: Console input handles cannot answer screen-buffer queries; updating shared cursor/window bookkeeping from an input-only handle requires opening CONOUT$ behind the user's back.
- **How libuv handles it**: `uv_tty_init` only initializes virtual-window/VT/style state for non-readable handles (tty.c:237-261). In 2012 libuv tried making readable handles open the console output too so they could update the virtual window — it was reverted the next day ("This is not the way to go").
- **History**: 1b929bff (2012-08-16) reverted by 95a742be (2012-08-17). Code keeps read-state and write-state in a union since 88634c14 — half-duplex by design (include/uv/win.h:495-530).
- **Bun disposition**: must-port the *separation* (input ttys: no screen-buffer access; output bookkeeping only on output handles). Target: win tty init.

### [TTY-08] VT support detection: try to set ENABLE_VIRTUAL_TERMINAL_PROCESSING and see if it sticks
- **What Windows does**: Win10 1511+ conhost accepts ENABLE_VIRTUAL_TERMINAL_PROCESSING (0x0004) on output handles and then interprets ANSI/VT sequences natively. Older conhost — and current conhost with the "Use legacy console" checkbox enabled, plus some emulators/Wine builds — reject the flag with an error. There is no query API; the only reliable probe is GetConsoleMode → SetConsoleMode(mode|flag) and checking for failure.
- **How libuv handles it**: `uv__determine_vterm_state` (tty.c:2343-2357): probe once; on success set `uv__vterm_state = UV_TTY_SUPPORTED`. Notably it does NOT restore the previous mode — VT processing is left enabled on the shared screen buffer for the process lifetime (shells are expected to reset *output* flags; see comment at tty.c:2326-2328). The probe runs lazily on the first *output* tty init, under the global output lock, guarded by `uv__need_check_vterm_state` (tty.c:250-253, 162-165).
- **History**: The ship→revert→re-ship saga: 58ccfd4c (libuv#889) added it; 8cbabaa8 reverted it because the first implementation ALSO bulk-converted output via MultiByteToWideChar and "Causes regressions on Windows 10 in applications that use ANSI codes" (node#9542, libuv#1135); 445e3a1f re-landed it with c2f0e4f6 fixing the conversion buffer. The real fix came later (TTY-12).
- **Bun disposition**: must-port. Even on 1809+, legacy-console mode and odd hosts still reject the flag, so the probe (and a defined UNSUPPORTED behavior) is required. Target: win tty init / colors.

### [TTY-09] Embedder override of VT state (uv_tty_set_vterm_state/get)
- **What Windows does**: n/a — policy hook.
- **How libuv handles it**: `uv_tty_set_vterm_state` / `uv_tty_get_vterm_state` (tty.c:2449-2461) let the embedder force SUPPORTED/UNSUPPORTED under the output lock; setting it also clears `uv__need_check_vterm_state` so the probe never runs. Node uses this for FORCE_COLOR-style behavior and tests.
- **History**: fd2ce38d (libuv#2501, 2019).
- **Bun disposition**: should-port (Bun.enableANSIColors / FORCE_COLOR plumbing wants the same override point). Target: win tty API.

### [TTY-10] Global output lock is a SEMAPHORE because it is released on a different thread than acquired
- **What Windows does**: Win32 CRITICAL_SECTION and most mutexes have thread affinity — releasing from another thread is UB/illegal. The line-read cancellation protocol (TTY-32) deliberately acquires the lock on the loop thread and releases it on the ReadConsole worker thread.
- **How libuv handles it**: `uv_tty_output_lock` is a `uv_sem_t` initialized to 1 (tty.c:145-149 comment, 170). It serializes: all emulated output, virtual-window updates, VT probing, SetConsoleMode in set_mode, and screen-state save/restore during cancellation — across ALL tty handles, because they all share one console.
- **History**: 84144036 (libuv#1054) switched CRITICAL_SECTION → semaphore exactly for the cross-thread release; comment added then.
- **Bun disposition**: must-port (a Rust Mutex/MutexGuard cannot express this; needs a semaphore or manual unsafe protocol — or redesign the cancel handshake). Target: win tty locking.

### [TTY-11] The virtual window: confine cursor addressing to the visible window, shared across all handles
- **What Windows does**: Console cursor coordinates are relative to the full screen *buffer* (e.g. 9999 lines of scrollback), not the visible window. Absolute VT cursor addressing (CSI H) against the buffer would let apps overwrite scrollback history, and the "client rect" moves when the user scrolls, so neither is usable directly.
- **How libuv handles it**: A process-global "virtual window" (big comment tty.c:90-118; state tty.c:116-118): always as wide as the buffer, as tall as the visible window, top anchored at the caret position when the first stdout/err tty was created (or as far down as fits). Output that runs past the bottom shifts the window down (never resizes it). All emulated cursor math goes through `uv__tty_make_real_coord` (tty.c:1181-1215) which clips x to [0,width) and y into the virtual window. `uv__tty_update_virtual_window` (tty.c:1158-1178) recomputes on every op and "if suddenly the cursor is outside the virtual window, it must have scrolled — update the offset". Shared by all uv_tty_t handles (hence the global lock, TTY-10).
- **History**: 622eb991/b0a9d601 (2011, original tty implementation); f5f005d5 (fix absolute positioning).
- **Bun disposition**: should-port — ONLY needed if Bun ships the ANSI emulator fallback (TTY-14). With VT passthrough, conhost does its own (equivalent) confinement. If Bun skips the emulator, skip this too, but keep the *concept* for get_winsize (TTY-48: height = window, not buffer).
- Target: win tty emulator.

### [TTY-12] Incremental byte-at-a-time UTF-8→UTF-16 decoder with state carried ACROSS write calls
- **What Windows does**: WriteConsoleA/the console codepage mangle UTF-8; WriteConsoleW wants UTF-16. JS runtimes hand the tty arbitrary byte chunks that can split a UTF-8 sequence (or a surrogate pair) across two uv_write calls.
- **How libuv handles it**: `uv__tty_write_bufs` decodes UTF-8 one byte at a time with persistent per-handle state `utf8_bytes_left`/`utf8_codepoint` (include/uv/win.h:519-520; tty.c:1716-1717, 1734-1784, saved back at 2184-2187). Crucially: the bulk `MultiByteToWideChar` fast path that 58ccfd4c added for VT-supported consoles was DELETED (3016fbc4) because it corrupted partial sequences split across writes — the incremental decoder now runs for both emulated and passthrough modes, and only the ANSI parsing is skipped when VT is supported (tty.c:1786-1788).
- **History**: 58ccfd4c → 8cbabaa8 revert → 445e3a1f + c2f0e4f6 → final shape 3016fbc4 (libuv#1965, JuliaLang/julia#27267). Also 9c064fbb/eb6d754a (2011): the gcc `__builtin_clz` branch was wrong (vs MSVC `_BitScanReverse`) — the bit-scan start-byte classification (tty.c:1741-1746) is easy to fumble.
- **Bun disposition**: must-port (the *requirement*: stateful streaming UTF-8→UTF-16 across writes; Bun's Rust strings layer should supply the decoder rather than the bit-scan trick). Target: win tty write.

### [TTY-13] Decoder error policy: U+FFFD, accept non-shortest forms, re-process stray start bytes
- **What Windows does**: n/a — robustness policy for arbitrary user bytes.
- **How libuv handles it**: Invalid start byte (0xFF/0xFE) or bare continuation → emit U+FFFD (tty.c:1756-1764); a start byte where a continuation was expected emits U+FFFD *and rewinds* (`j--`) so the byte is re-parsed as a start byte (tty.c:1772-1779); non-shortest-form encodings and invalid codepoints are deliberately accepted ("there's no real harm", tty.c:1734-1736). Codepoints > 0xFFFF are emitted as UTF-16 surrogate pairs (tty.c:2170-2176) — until 2020 they were replaced with U+FFFD because old UCS-2 conhost couldn't render them; modern conhost/Windows Terminal can (aa4fcc49, libuv#2909).
- **History**: aa4fcc49 (surrogate passthrough, 2020); decoder policy from fb713861 (2011).
- **Bun disposition**: must-port (incl. surrogate-pair emission; Bun strings are WTF-8 so lone surrogates → unpaired UTF-16 code units should pass through to WriteConsoleW unmolested). Target: win tty write.

### [TTY-14] Full ANSI/VT100 emulator exists ONLY as fallback when the VT probe fails
- **What Windows does**: Legacy conhost has no escape-sequence processing; everything must be translated to Win32 console API calls (SetConsoleCursorPosition, SetConsoleTextAttribute, FillConsoleOutput*).
- **How libuv handles it**: When `uv__vterm_state == UV_TTY_SUPPORTED`, escape codes pass through untouched (tty.c:1786-1788). Otherwise a state machine (states tty.c:44-53) implements: CSI A/B/C/D/E/F/G/H/f (cursor), J/K (erase), m (SGR), s/u (save/restore), `ESC 7/8`, `ESC c` (full reset), `CSI ? 25 l/h` (cursor visibility), DECSCUSR `CSI Ps SP q` (cursor shape). Everything else is parsed and *swallowed*: ANSI_IGNORE eats until a final byte (tty.c:1853-1858); OSC/DCS/PM/APC (`ESC ]`,`P`,`^`,`_`) enter ANSI_ST_CONTROL and eat until BEL or ESC\ with embedded-string quote handling (tty.c:2108-2138). CSI args: max 4, each capped at UINT16_MAX, overflow/too-many → IGNORE (tty.c:1887-1940). `?` only honored as first char after CSI (tty.c:1942-1950). An inconsistent parser state calls abort() (tty.c:2139-2142).
- **History**: fb713861 (2011 "Improve ansi escape code support"); 21b1b87d (?25l/h); 288a0672 (DECSCUSR); e56717ae (inverse).
- **Bun disposition**: should-port — judgment call. On 1809+ the emulator only triggers for "Use legacy console" mode, ancient Wine, and exotic hosts. Minimum viable Bun: probe (TTY-08) + passthrough when supported + *swallow-or-passthrough policy decided explicitly* when unsupported (raw ESC garbage on legacy console is ugly but rare). If Bun ever ships the emulator, port this exact subset and the swallowing behavior. Record the decision either way. Target: win tty emulator.

### [TTY-15] WriteConsoleW in ≤8192-WCHAR chunks
- **What Windows does**: WriteConsoleW marshals through a shared heap to conhost; very large single writes fail (historically ~64KB of payload). "Windows can't handle much more characters in a single console write anyway."
- **How libuv handles it**: Fixed stack buffer `WCHAR utf16_buf[MAX_CONSOLE_CHAR]` with MAX_CONSOLE_CHAR=8192 (tty.c:56, 1696-1698); ENSURE_BUFFER_SPACE flushes before overflow (tty.c:1710-1713); FLUSH_TEXT writes via `uv__tty_emit_text` → WriteConsoleW (tty.c:1218-1236). No partial-write loop — within this size WriteConsoleW is all-or-nothing.
- **History**: comment + constant from fb713861 era; buffer simplified by 3016fbc4.
- **Bun disposition**: must-port (chunk cap on console writes). Target: win tty write.

### [TTY-16] EOL conversion: \n → \r\n, lone \r preserved, \n\r collapsed — with state across writes
- **What Windows does**: Raw console output without VT treats \n as "move down one line" only in some modes; programs and pseudo-consoles disagree. Also `\r` alone is a meaningful cursor-to-column-0 operation that must NOT become a newline.
- **How libuv handles it**: tty.c:2144-2163: emit `\r\n` for `\n` not preceded by `\r`; suppress the `\r` of `\n\r` (already emitted); pass lone `\r` through unchanged. `previous_eol` persists on the handle across write calls (include/uv/win.h:522). This conversion runs in BOTH emulated and VT-passthrough modes. 7cd0cd8a (2015) fixed the original behavior that converted `\r` → `\r\n` — it broke progress bars/spinners that rewrite a line with bare `\r` ("\r is a single carriage return without line feed on all platforms, including Windows").
- **History**: 7cd0cd8a (libuv#472).
- **Bun disposition**: must-port if Bun mirrors libuv tty write semantics (Node compat: process.stdout on Windows does this conversion); note modern conhost+VT handles `\n` via auto-return, but the cross-write `\n\r` collapse and lone-`\r` preservation are behavioral compat surface. Target: win tty write.

### [TTY-17] Capture the console's INITIAL style once; treat black-on-black as white-on-black
- **What Windows does**: SGR reset (`ESC[0m`) must restore the *user's configured* colors, not a hardcoded white-on-black — users customize console colors. Some environments report attribute word 0 (black on black).
- **How libuv handles it**: `uv__tty_capture_initial_style` (tty.c:309-364): once per process (under output lock), snapshot wAttributes + cursor info; decompose into default fg/bg color, brightness, and inverse (COMMON_LVB_REVERSE_VIDEO); `attributes==0` is coerced to 7 (tty.c:322-324). All SGR resets and 39/49 reference these defaults.
- **History**: 517ade8a (libuv#431, 2015 — previously assumed Windows default colors).
- **Bun disposition**: should-port — only needed by the emulator (TTY-14); skip if emulator skipped. (Bun's own "reset color at exit" logic should instead emit `ESC[0m` through VT.) Target: win tty emulator.

### [TTY-18] SGR emulation details: aixterm brights, brightness-restoring 39/49, inverse via FLIP_FGBG
- **What Windows does**: Console attributes are a WORD of 4-bit fg/bg + intensity bits + COMMON_LVB_REVERSE_VIDEO (0x4000, missing from old SDKs — defined at tty.c:28-30). There is no native "inverse" rendering in the attribute model used pre-VT; you must swap nibbles.
- **How libuv handles it**: `uv__tty_set_style` (tty.c:1421-1574): 90-97/100-107 aixterm bright colors (3ade5f00); 1/2/5/21/22/25 brightness on/off mapping (nonstandard: 5 = "background bright on", 21/22 = fg bright off, 25 = bg bright off — a deliberate legacy-conhost-era convention, not real SGR blink/underline); 39/49 restore default color AND default brightness (b2dc1e6d, 443445a3 — forgetting brightness was a real bug); inverse implemented by un-flipping current attrs if REVERSE_VIDEO set, applying changes, re-flipping (FLIP_FGBG macro tty.c:1412-1419, applied 1522-1524/1564-1566).
- **History**: 3ade5f00 (2012 aixterm); 443445a3 + b2dc1e6d (brightness reset); e56717ae (inverse).
- **Bun disposition**: should-port — emulator-only (TTY-14). If skipped, record that legacy-console SGR rendering is unsupported. Target: win tty emulator.

### [TTY-19] Flush buffered text BEFORE any emulated control operation
- **What Windows does**: Emulated operations (cursor move, clear, attribute change) act on the console immediately, but printable text is batched in the 8K WCHAR buffer; reordering corrupts output (text appears after the cursor already moved / with the wrong attributes).
- **How libuv handles it**: Every emulated op site calls FLUSH_TEXT() first — reset (tty.c:1823), save/restore (1830-1838), every CSI command (1968-2092). 45882e0b (2011) fixed the original miss for `ESC c`.
- **History**: 45882e0b ("flush output buffer before doing a console reset").
- **Bun disposition**: should-port (emulator-only ordering invariant). Target: win tty emulator.

### [TTY-20] Retry console ops on ERROR_INVALID_PARAMETER — the console may have been resized mid-operation
- **What Windows does**: GetConsoleScreenBufferInfo → compute coords → SetConsoleCursorPosition/FillConsoleOutput* is inherently racy: the user can resize the window between the query and the op, making previously valid coordinates invalid; the API then fails with ERROR_INVALID_PARAMETER.
- **How libuv handles it**: `goto retry` loops that re-query the screen buffer and recompute on exactly ERROR_INVALID_PARAMETER, in `uv__tty_move_caret` (tty.c:1248-1263), `uv__tty_reset` (1292-1317), `uv__tty_clear` (1379-1407). Any other error aborts the write with that error.
- **History**: present since the original emulator (fb713861 era); code comments only ("The console may be resized - retry").
- **Bun disposition**: should-port (emulator-only); the general lesson — query+act on console geometry is racy against user resize, retry on INVALID_PARAMETER — is must-keep knowledge for ANY Bun code that does SetConsoleCursorPosition (e.g. test reporters). Target: win tty emulator / general console ops.

### [TTY-21] ESC c (full reset) also restores cursor SHAPE and re-anchors the virtual window
- **What Windows does**: "Reset" on a real terminal restores cursor appearance; the Win32 analog is SetConsoleCursorInfo with the startup-captured CONSOLE_CURSOR_INFO.
- **How libuv handles it**: `uv__tty_reset` (tty.c:1269-1330): restore default attributes, home the cursor, fill the whole buffer with spaces+default attrs (with resize retry), set `uv_tty_virtual_offset = 0`, and restore `uv_tty_default_cursor_info` captured at init (73ca4ac0). DECSCUSR (TTY-22) made capturing/restoring the cursor shape necessary.
- **History**: 73ca4ac0 (2020).
- **Bun disposition**: should-port (emulator-only). Target: win tty emulator.

### [TTY-22] DECSCUSR cursor-shape mapped onto cursor SIZE (25% vs 100%), visibility via ?25l/h
- **What Windows does**: Legacy console has no bar/underline cursor shapes — only a fill-percentage (dwSize 1-100) and a visibility bool in CONSOLE_CURSOR_INFO.
- **How libuv handles it**: `CSI Ps SP q`: style 0 → startup default size; 1-2 (block) → 100; 3-6 (underline/bar) → 25 (CURSOR_SIZE_LARGE/SMALL, tty.c:65-66, 1667-1689; parser state ANSI_DECSCUSR tty.c:1860-1881). `CSI ?25l/h` → GetConsoleCursorInfo/SetConsoleCursorInfo bVisible (tty.c:1647-1665, dispatch 1963-1980).
- **History**: 288a0672 (DECSCUSR, 2020); 21b1b87d (?25l/h, 2012).
- **Bun disposition**: should-port (emulator-only). Target: win tty emulator.

### [TTY-23] Write errors: stop I/O but KEEP PARSING to keep decoder/parser state consistent
- **What Windows does**: n/a — state-machine hygiene.
- **How libuv handles it**: `uv__tty_write_bufs` stores the first error in `*error` and every emitting helper early-returns if `*error != ERROR_SUCCESS`, but the byte loop continues so `utf8_bytes_left`/`ansi_parser_state`/`previous_eol` end the call in a consistent state for the next write (comment tty.c:1721-1723).
- **History**: code comment only.
- **Bun disposition**: must-port (if any stateful decode exists, error paths must still advance it). Target: win tty write.

### [TTY-24] TTY writes are synchronous on the loop thread; completion is deferred via a pending req; try_write gated on no pending writes
- **What Windows does**: Console writes have no overlapped/IOCP form; WriteConsoleW blocks (briefly).
- **How libuv handles it**: `uv__tty_write` (tty.c:2201-2228) performs the whole write inline under the output semaphore, then queues the req as already-completed so the callback still runs from the loop (uv ordering contract). `uv__tty_try_write` (tty.c:2231-2243) returns UV_EAGAIN if any write reqs are pending — order preservation.
- **History**: 55ea3712 (try_write support); 5656e3c8 ("Prepare for writable TTY to be blocking", 2011).
- **Bun disposition**: must-port (Bun's writer should treat console writes as synchronous-but-callback-deferred; matches Node's "stdout is sync on Windows tty"). Target: win tty write.

### [TTY-25] Raw-mode input readiness via RegisterWaitForSingleObject on the console handle — no dedicated thread
- **What Windows does**: A console *input* handle is a waitable object: it signals when input records are available. This means readiness can be obtained from the thread-pool wait machinery instead of a blocking reader thread (console handles do not support IOCP/overlapped reads).
- **How libuv handles it**: `uv__tty_queue_read_raw` (tty.c:478-506): RegisterWaitForSingleObject(handle, callback, INFINITE, WT_EXECUTEINWAITTHREAD|WT_EXECUTEONLYONCE). The callback (`uv_tty_post_raw_read`, tty.c:458-475) runs on the wait thread, calls UnregisterWait on itself (legal because EXECUTEONLYONCE + non-blocking form), then posts a completion to the IOCP via POST_COMPLETION_FOR_REQ. Actual record reading happens later on the LOOP thread (TTY-26). Registration failure → SET_REQ_ERROR + insert pending req (error surfaces through normal read_cb path).
- **History**: original tty implementation 622eb991 (2011).
- **Bun disposition**: must-port (the pattern: console-input wait → wake loop; whether via RegisterWait or a parked waiter thread is Bun's choice, but no busy reader thread and no IOCP on console handles). Target: win tty read raw.

### [TTY-26] Drain input records on the loop thread: count, then read ONE record at a time, allocate output lazily
- **What Windows does**: ReadConsoleInputW blocks if no records are available, so you must GetNumberOfConsoleInputEvents first; the stream contains lots of irrelevant records (mouse, focus, menu) that should not allocate user buffers.
- **How libuv handles it**: `uv_process_tty_read_raw_req` (tty.c:720-974): query `records_left`, loop `while (records_left > 0 || last_key_len > 0)` re-checking UV_HANDLE_READING every iteration (user may uv_read_stop from the read_cb mid-drain); ReadConsoleInputW with count=1 keeps `last_input_record` as carryover state for repeat expansion (TTY-29); the user buffer is allocated on demand only when there are bytes to emit (tty.c:759-762, 925-933), emitted (possibly multiple read_cb calls) whenever full (tty.c:938-943), and flushed at loop end (tty.c:959-962).
- **History**: 622eb991; resilience tweaks d796bedf (alloc_cb failure → UV_ENOBUFS).
- **Bun disposition**: must-port (incl. the re-check-READING-every-iteration re-entrancy guard and the lazy alloc). Target: win tty read raw.

### [TTY-27] KEY_EVENT→VT100 translation table, Cygwin-compatible
- **What Windows does**: Raw console input is INPUT_RECORDs with virtual-key codes, not byte sequences; something must synthesize the escape sequences a terminal would produce.
- **How libuv handles it**: `get_vt100_fn_key` (tty.c:654-717): arrows/home/end/pgup/pgdn/ins/del/numpad/F1-F12 with shift/ctrl/shift+ctrl variants. Documented provenance (tty.c:673-676): "same as Cygwin's. Unmodified and alt-modified keypad keys comply with linux console, modifiers comply with xterm modifier usage. F1-F12 and shift F1-F10 comply with linux console, F6-F12 with and without modifiers comply with rxvt." Unmappable keys are silently dropped (tty.c:901-904). Character keys need no table — conhost already fills uChar with control chars for Ctrl+letter. NOTE these differ from Windows' own VT input sequences (e.g. F1 → `ESC[[A` here vs `ESC OP` from ENABLE_VIRTUAL_TERMINAL_INPUT) — this is exactly why RAW_VT was made opt-in (TTY-41).
- **History**: 622eb991; table essentially frozen since 2011 — the entire Node-on-Windows keypress ecosystem (readline) is built against it.
- **Bun disposition**: must-port verbatim (byte-for-byte; Node's readline keypress parser expects these exact sequences in RAW mode). Target: win tty read raw.

### [TTY-28] Keyup filtering with the Alt+Numpad exception — two regressions deep
- **What Windows does**: Key events come as down AND up records; normally only keydown matters. EXCEPT: Alt+Numpad composition (and IME-injected input, and WSL's translation layer) delivers the composed character on the VK_MENU *keyup* record's UnicodeChar. Under WSL, keyups of normal keys also arrive with LEFT_ALT_PRESSED set spuriously.
- **How libuv handles it**: tty.c:792-798: ignore keyup UNLESS `wVirtualKeyCode == VK_MENU && UnicodeChar != 0`. This exact condition was wrong twice: d2e59bb6 removed the LEFT_ALT_PRESSED state check (WSL spurious flag, libuv#2111), but flipped the boolean wrong (`&&` of negations) causing every fn-key sequence to be emitted TWICE (down and up) — node#25875/#26013 — fixed by 7ed1eced (libuv#2168) restoring De Morgan correctness (`||`).
- **History**: d2e59bb6 (2018) → 7ed1eced (2019). A textbook condition-polarity regression.
- **Bun disposition**: must-port (test both: fn keys emit once; Alt+Numpad composed char arrives; works under WSL's console proxy). Target: win tty read raw.

### [TTY-29] Suppress nav/numpad keyDOWNs while left-Alt is held (composition in progress), keyed on !ENHANCED_KEY
- **What Windows does**: During Alt+Numpad composition the user's digit/navigation keydowns stream in as normal events before the composed char arrives on Alt keyup. The numpad and the gray nav cluster share VK codes — distinguished only by the ENHANCED_KEY flag (gray keys are "enhanced").
- **How libuv handles it**: tty.c:800-826: ignore keydown if LEFT_ALT_PRESSED && !ENHANCED_KEY && VK in {INSERT,END,DOWN,NEXT,LEFT,CLEAR,RIGHT,HOME,UP,PRIOR,NUMPAD0-9}. Gray (enhanced) Alt+Arrow still produces ESC-prefixed sequences (TTY-30).
- **History**: 68cd6d6a era; comment "because the user is composing a character, or windows simulating this".
- **Bun disposition**: must-port. Target: win tty read raw.

### [TTY-30] Alt → ESC prefix; but NOT when Ctrl is also down (AltGr)
- **What Windows does**: International keyboards deliver AltGr as LEFT_CTRL_PRESSED|RIGHT_ALT_PRESSED; treating that as "Alt held" would ESC-prefix every AltGr character (€, @, etc. on many layouts).
- **How libuv handles it**: Character keys: prefix `\033` only if (LEFT|RIGHT_ALT) && !(LEFT|RIGHT_CTRL) && bKeyDown (tty.c:841-850). Function keys: prefix `\033` if any Alt held (no Ctrl exclusion — Ctrl is encoded in the table variant instead) (tty.c:906-912).
- **History**: 622eb991/68cd6d6a era; code comments only.
- **Bun disposition**: must-port (AltGr exclusion is the part everyone gets wrong; test with a German/Spanish layout). Target: win tty read raw.

### [TTY-31] UTF-16 surrogate reassembly across separate INPUT_RECORDs; output as WTF-8
- **What Windows does**: A non-BMP character typed/pasted arrives as TWO KEY_EVENT records, one carrying the high surrogate, one the low. They are not guaranteed adjacent in one read batch.
- **How libuv handles it**: High surrogate (0xD800-0xDBFF) is stashed in `last_utf16_high_surrogate` on the handle and the record otherwise skipped (tty.c:834-839); the next character record is paired with it and converted via `uv_utf16_to_wtf8` (tty.c:854-864), so unpaired surrogates degrade to WTF-8 instead of erroring (post-f3889085). Conversion failure (impossible for WTF-8) error-paths the read.
- **History**: 68cd6d6a (ReadConsoleA→W + surrogate handling, 2014); f3889085 (WideCharToMultiByte → uv_utf16_to_wtf8, 2023).
- **Bun disposition**: must-port (state on the handle; emit WTF-8 — matches Bun's string model). Target: win tty read raw.

### [TTY-32] wRepeatCount expansion: one record may encode N keypresses
- **What Windows does**: Auto-repeat (key held down) is coalesced: a single KEY_EVENT_RECORD carries wRepeatCount > 1.
- **How libuv handles it**: After the translated bytes for the current record are fully copied out, `--KEV.wRepeatCount > 0` resets `last_key_offset = 0` to replay the same sequence again (tty.c:948-952); the record itself is the persistent state (`last_input_record` on the handle).
- **History**: 622eb991.
- **Bun disposition**: must-port (missing this makes key-repeat emit single chars; holding an arrow key in a TUI would feel broken). Target: win tty read raw.

### [TTY-33] Partial-key carryover across user buffers and across read stop/start
- **What Windows does**: n/a — uv buffer management, but with a crash story.
- **How libuv handles it**: Translated bytes live in `last_key[8]` with `last_key_offset/len`; the drain loop copies byte-at-a-time into the user buffer, emitting and re-allocating whenever full (tty.c:922-946). If the user stops reading mid-key and restarts, `uv__tty_read_start` short-circuits: if `last_key_len > 0`, insert an already-successful pending req instead of queueing a new console wait — AND must set UV_HANDLE_READ_PENDING to prevent a second insert if stop/start happens again before the req is processed (assert crash, node#9690).
- **History**: 357b9a77 (libuv#1158, 2016).
- **Bun disposition**: must-port (carryover + the double-insert guard). Target: win tty read raw.

### [TTY-34] Stopping a raw read: write a dummy event to wake the console wait — EventType must be VALID
- **What Windows does**: There is no cancel API for a registered console-handle wait that also resolves an in-flight signal; the clean way is to make the handle signal. WriteConsoleInputW with a zeroed record worked for years, then a Windows update made it reject EventType 0 with ERROR_INVALID_PARAMETER.
- **How libuv handles it**: `uv__tty_read_stop` (tty.c:1072-1100): for raw mode, write one record with `EventType = FOCUS_EVENT` (memset 0 otherwise) — chosen because the drain loop ignores non-KEY_EVENT records (commented "Write some bullshit event to force the console wait to return", tty.c:1083-1089). The wait callback then unregisters itself; UV_HANDLE_READING is already cleared so the drained req is dropped.
- **History**: b9a08403 (libuv#1989, node#21773, 2018 — "New Windows version requires EventType to be set to something meaningful").
- **Bun disposition**: must-port (FOCUS_EVENT specifically; also guarantees the endgame invariant in TTY-46). Target: win tty read raw.

### [TTY-35] Line mode reads run on a worker thread blocking in ReadConsoleW; buffer capped at 8KB; utf16 = bytes/3
- **What Windows does**: Cooked-mode console reading (line editing, echo, F7 history…) only exists inside ReadConsoleW, which blocks until Enter — incompatible with an event loop. Also "ReadConsole can't handle big buffers" (large lengths fail).
- **How libuv handles it**: `uv__tty_queue_read_line` (tty.c:605-642): alloc_cb(suggested 8192) on the LOOP thread, then QueueUserWorkItem(uv_tty_line_read_thread, WT_EXECUTELONGFUNCTION). The thread (tty.c:509-602) caps the byte budget at MAX_INPUT_BUFFER_LENGTH=8192 (tty.c:55, 531-536) and sizes the UTF-16 request as `chars = bytes / 3` into a stack `WCHAR utf16[8192/3]` — one UTF-16 code unit never expands past 3 WTF-8 bytes (tty.c:538-540). Flag state (`uv__read_console_status = NOT_STARTED`, `uv__restore_screen_state = FALSE`) is reset before queueing, "relying on the memory barrier provided by QueueUserWorkItem" (tty.c:627-631).
- **History**: 68cd6d6a (ReadConsoleA→ReadConsoleW); original threading from 622eb991.
- **Bun disposition**: must-port (Node parity: stdin in non-raw TTY mode = cooked ReadConsoleW on a worker; Bun cannot fake cooked mode with raw reads without losing console line editing/history/IME). Target: win tty read line.

### [TTY-36] Line-read UTF-16 → WTF-8 must reserve 1 byte for the NUL — off-by-one heap overflow (security advisory)
- **What Windows does**: n/a — conversion-contract bug class.
- **How libuv handles it**: `uv_utf16_to_wtf8` NUL-terminates; callers must pass capacity-1. tty.c:557-565 now does `read_bytes = bytes - 1` (with `assert(bytes > 0)`). Before the fix, input where every UTF-16 unit encoded to exactly 3 bytes (CJK) with a buffer length divisible by 3 wrote the NUL one byte past the user-allocated buffer.
- **History**: ec0ab5d7 (2026-03, GHSA-4prr-4742-3ccf) fixing f3889085 (2023) — the other two call sites in src/win/util.c already subtracted 1; tty.c was the odd one out for 2.5 years.
- **Bun disposition**: must-port the lesson (in Rust: make the conversion API take an output slice and return length — no implicit NUL contract to forget). Target: win tty read line / strings.

### [TTY-37] Cancelling a blocked ReadConsoleW: inject a fake VK_RETURN keypress (closing the handle does NOT work)
- **What Windows does**: Closing (even a duplicated) console handle does not reliably make a blocked ReadConsoleW return on Windows 7+. CancelSynchronousIo doesn't work on console reads either. The only reliable unblock is to complete the line: write an Enter key event into the input queue with WriteConsoleInputW.
- **How libuv handles it**: `uv__cancel_read_console` (tty.c:1102-1155): build a full KEY_EVENT record — bKeyDown=TRUE, wRepeatCount=1, VK_RETURN, scan code via MapVirtualKeyW, UnicodeChar='\r' (tty.c:1140-1147) — and WriteConsoleInputW it. The pre-2016 design duplicated the handle and closed the duplicate; that was removed (349aa6c0) when the duplicate stopped working. Symptom of the old breakage: after switching line→raw mode, keypresses were held hostage until the user pressed Enter (libuv#852).
- **History**: e51442bb + 349aa6c0 + 9eb13119 (libuv#866 trilogy, 2016).
- **Bun disposition**: must-port (the entire mechanism; there is still no better API as of Win11 conhost — ConPTY-hosted stdin behaves the same for cooked reads). Target: win tty read line.

### [TTY-38] After the fake Enter: restore the saved cursor position to erase the phantom newline — minus one row if we were on the buffer's last line
- **What Windows does**: The injected VK_RETURN is *echoed* by cooked mode: the cursor visibly drops a line (and the buffer SCROLLS if the cursor was on the last buffer row).
- **How libuv handles it**: Canceller saves CONSOLE_SCREEN_BUFFER_INFO of the active screen buffer (opened fresh via `CreateFileA("conout$")`, because the tty handle being cancelled is the INPUT handle) before injecting (tty.c:1124-1137, sets `uv__restore_screen_state`). After ReadConsoleW returns, the READER thread re-opens conout$ and SetConsoleCursorPosition to the saved spot — adjusted `pos.Y--` if the saved Y was `dwSize.Y - 1` because the echo scrolled everything up one line (tty.c:572-597). Node calls read_start/read_stop in rapid succession at startup, so without this users saw stray blank lines.
- **History**: 9eb13119 (libuv#866).
- **Bun disposition**: must-port (cosmetic but extremely visible; Node-parity REPL/prompt behavior). Target: win tty read line.

### [TTY-39] The 4-state interlocked handshake between canceller and reader — and the deadlock when one transition was missing
- **What Windows does**: n/a — lock-free coordination over a global because the reader is a thread-pool thread that may not have started yet when cancel arrives.
- **How libuv handles it**: Global `uv__read_console_status` ∈ {NOT_STARTED, IN_PROGRESS, TRAP_REQUESTED, COMPLETED} (tty.c:78-87). Reader: `InterlockedExchange(IN_PROGRESS)`; if previous was TRAP_REQUESTED, complete immediately with 0 bytes AND set COMPLETED (tty.c:542-549). Otherwise ReadConsoleW, then `InterlockedExchange(COMPLETED)`; if previous was TRAP_REQUESTED, do the screen restore and `uv_sem_post(uv_tty_output_lock)` — releasing the semaphore the CANCELLER acquired (tty.c:570-599). Canceller (under the semaphore): `InterlockedExchange(TRAP_REQUESTED)`; if previous != IN_PROGRESS, post semaphore and done (trap armed before read started, or read already finished); else keep holding the semaphore (reader will release), save screen, inject VK_RETURN (tty.c:1111-1148). THE BUG (fixed 2020): the reader's early-trap path forgot to set COMPLETED, leaving the status IN_PROGRESS forever; the *next* cancel saw IN_PROGRESS, held the semaphore, and waited for a reader that didn't exist → deadlock (node#32999).
- **History**: 84144036 (libuv#1054, node#7837 — introduced the machine + semaphore); aeab873b (libuv#2882, node#32999 — the missing COMPLETED).
- **Bun disposition**: must-port (port the *fixed* machine exactly, including the early-trap COMPLETED transition and the cross-thread semaphore release; this is the highest-risk concurrency dance in the file). Target: win tty read line.

### [TTY-40] Results of a cancelled line read are silently discarded; zero-byte reads never reach the callback
- **What Windows does**: The cancelled ReadConsoleW still "succeeds", returning whatever the user had typed plus the fake `\r\n`.
- **How libuv handles it**: UV_HANDLE_CANCELLATION_PENDING is set by read_stop when a cancel is dispatched (tty.c:1090-1097, asserted single-shot at 1109); `uv_process_tty_read_line_req` drops the data entirely when the flag is set, and ALSO suppresses `read_cb(0)` callbacks in all cases — `nread == 0` means EAGAIN in uv semantics and confused consumers (tty.c:1001-1008). 961e0cf8 (2012): never report an *error* after a forced abort either. Consequence: a partially-typed line at cancel time is consumed and lost — accepted tradeoff since mode switches happen at prompt boundaries.
- **History**: 961e0cf8 (2012); b901e262 (libuv#2012/#2014, 2018 — remove zero-size callbacks).
- **Bun disposition**: must-port (incl. the no-zero-byte-callback rule). Target: win tty read line.

### [TTY-41] Raw vs line completion discrimination via read_line_buffer.len == 0 (self-acknowledged hack)
- **What Windows does**: n/a.
- **How libuv handles it**: One shared read_req per handle; `uv__process_tty_read_req` dispatches on `read_line_buffer.len == 0` → raw else line (tty.c:1020-1033), with a FIXME: "This is quite obscure. Use a flag or something." Raw queueing nulls the buffer first (tty.c:487).
- **History**: code comment only (cb1acaa4 updated the TODO).
- **Bun disposition**: skip the hack itself (Bun should use an explicit enum on the request) but must-keep the invariant it encodes: only ONE outstanding console read of either kind per handle. Target: win tty read.

### [TTY-42] uv_tty_set_mode: stop reads BEFORE SetConsoleMode; SetConsoleMode under the output lock; restart after
- **What Windows does**: If a cooked ReadConsoleW is started (or still in flight) while/after the console flips to raw mode, it misbehaves — and a line-read cancellation mutates screen state that concurrent writers would corrupt.
- **How libuv handles it**: tty.c:401-434: (1) if reading, uv__tty_read_stop (which performs the cancel handshake) and remember alloc/read cbs; (2) SetConsoleMode while holding `uv_tty_output_lock` (tty.c:416-423); (3) restart reading. Order (1)→(2) is load-bearing: "we need to stop any pending reads *before* calling SetConsoleMode, or a call to ReadConsole could start while the console is still in raw mode" (node#7837 — Node REPL hangs).
- **History**: 84144036 (libuv#1054, 2016).
- **Bun disposition**: must-port (exact ordering). Target: win tty mode.

### [TTY-43] Mode flag sets: NORMAL deliberately avoids touching INSERT/QUICKEDIT; RAW is ENABLE_WINDOW_INPUT only
- **What Windows does**: ENABLE_INSERT_MODE / ENABLE_QUICK_EDIT_MODE are *user preferences* stored on the console; programmatically setting them (which requires ENABLE_EXTENDED_FLAGS) stomps the user's choices — e.g. killing QuickEdit copy/paste (node#4809). ENABLE_WINDOW_INPUT in raw mode opts into WINDOW_BUFFER_SIZE_EVENT records (resize fallback, TTY-49).
- **How libuv handles it**: tty.c:384-394: NORMAL = ENABLE_ECHO_INPUT|ENABLE_LINE_INPUT|ENABLE_PROCESSED_INPUT (note: SetConsoleMode without ENABLE_EXTENDED_FLAGS leaves insert/quick-edit alone); RAW = ENABLE_WINDOW_INPUT (no PROCESSED → Ctrl+C arrives as data… via the signal path; cross-ref SIGNALS). The 2013 fix removed both ENABLE_INSERT_MODE|ENABLE_EXTENDED_FLAGS from NORMAL and the "restore original_console_mode" behavior (the snapshot could itself contain stale flags).
- **History**: 4abad238 (node#4809, 2013).
- **Bun disposition**: must-port (exact flag sets; resist the temptation to "restore" a captured mode on every NORMAL switch — that is what reset_mode at exit is for). Target: win tty mode.

### [TTY-44] UV_TTY_MODE_RAW_VT: try ENABLE_VIRTUAL_TERMINAL_INPUT with silent fallback, arm exit-time reset
- **What Windows does**: ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) makes conhost/Windows Terminal deliver keys as standard VT byte sequences inside KEY_EVENT records (enables bracketed paste, modified keys, etc. that Win32 records cannot express). Two traps: (a) legacy console rejects it; (b) shells (PowerShell included) reset *output* VT flags when a child exits but NOT input flags — a process dying in RAW_VT leaves the parent shell's stdin unusable (microsoft/terminal#4954).
- **How libuv handles it**: tty.c:388-391: RAW_VT = RAW flags + try_set_flags=ENABLE_VIRTUAL_TERMINAL_INPUT, and `InterlockedExchange(&uv__tty_console_in_need_mode_reset, 1)` BEFORE attempting. SetConsoleMode is tried with the VT flag, then silently retried without it (tty.c:417-418) — RAW_VT degrades to RAW with no error and mode.mode still records RAW_VT (callers can't detect the degrade; deliberate). `uv_tty_reset_mode` (tty.c:2324-2337) then restores the *startup-captured* input mode iff the need-reset flag was armed, via InterlockedExchange so it is idempotent and safe from exit/signal paths. The translator (TTY-27/28) still runs in RAW_VT — VT input just changes what the records contain (chars instead of naked virtual-key fn-keys); keyup filtering, surrogates, repeat expansion all still apply.
- **History**: 843b64fa (libuv#4688, Anna Henningsen, Feb 2025); commit message documents the PowerShell behavior and that RAW_VT is opt-in because its sequences differ from libuv's cygwin-style table; intended default in a hypothetical v2.
- **Bun disposition**: must-port (Node ≥24 readline uses it for bracketed paste; Bun needs: the two-step SetConsoleMode, the armed-reset-at-exit, and reset-on-crash wiring). Target: win tty mode + process exit.

### [TTY-45] Mode bookkeeping details: dedupe, EINVAL, ENOTSUP, and the ABI-union hack
- **What Windows does**: n/a.
- **How libuv handles it**: Same-mode set is a no-op (tty.c:379-381); UV_TTY_MODE_IO → UV_ENOTSUP on Windows (it's a termios concept, tty.c:395-396); unknown mode → UV_EINVAL (tty.c:397-398, added after a caller passed garbage, libuv#941); set_mode on a non-readable tty → UV_EINVAL (tty.c:375-377). The stored mode lives in a union overlaying a dead HANDLE field (`mode.unused_`) kept only for v1 ABI stability (tty.c:275-278; include/uv/win.h:502-506) — init writes NULL to the whole union then the int.
- **History**: 025602da (MODE_IO, 2014); ef6f3e8e (EINVAL, 2016); 349aa6c0 (freed the HANDLE slot); 843b64fa (turned the slot into mode storage).
- **Bun disposition**: must-port the semantics (dedupe/EINVAL/ENOTSUP); skip the union hack (no ABI legacy in Bun). Target: win tty mode.

### [TTY-46] Endgame invariant: the raw wait must have unregistered itself before close completes
- **What Windows does**: UnregisterWait racing a firing callback is a classic UAF source; blocking UnregisterWaitEx from the loop would stall the loop.
- **How libuv handles it**: The wait callback is the ONLY place that UnregisterWaits and nulls `read_raw_wait` (tty.c:470-471); read_stop never touches it, it just guarantees the callback fires soon via the FOCUS_EVENT poke (TTY-34). `uv__tty_endgame` asserts `read_raw_wait == NULL` for readable ttys (tty.c:2310-2321) — close cannot finish until the callback ran (reqs_pending holds the handle alive).
- **History**: 87226331 (endgame check fix, 2012); structure from 622eb991.
- **Bun disposition**: must-port (whatever Bun's wait primitive is, tear-down must be ack'd by the waiter side, never forced from the closer). Target: win tty close.

### [TTY-47] TTY shutdown is a no-op that must still run its callback (0 or ECANCELED)
- **What Windows does**: n/a — console output has no half-close.
- **How libuv handles it**: `uv__process_tty_shutdown_req` (tty.c:2290-2307): after pending writes drain, call cb(0), or cb(UV_ECANCELED) if the handle is closing. Cross-ref: STREAM shutdown dispatch (ee970e38, 7bccb562 reworked how it's dispatched).
- **History**: bdac72cc (2011); cf05c5f0 (ECANCELED on premature close).
- **Bun disposition**: must-port (callback-contract parity). Target: win tty close / stream.

### [TTY-48] get_winsize: width = BUFFER width, height = visible WINDOW height
- **What Windows does**: GetConsoleScreenBufferInfo exposes both dwSize (buffer, e.g. 120×9001 with scrollback) and srWindow (visible rect). A "terminal size" must mix them: columns from the buffer (== window width in practice), rows from the window — reporting buffer height would tell apps the terminal is 9001 rows tall.
- **How libuv handles it**: `uv_tty_get_winsize` (tty.c:440-455) → `uv__tty_update_virtual_window` (tty.c:1158-1160): width = dwSize.X, height = srWindow.Bottom - srWindow.Top + 1. Same formula in the resize watcher (tty.c:2435-2436). Note it requires an OUTPUT handle (GetConsoleScreenBufferInfo fails on CONIN$).
- **History**: 03652596/622eb991.
- **Bun disposition**: must-port (exact formula; Node's process.stdout.columns/rows). Target: win tty winsize.

### [TTY-49] Resize detection: find conhost's PID via NtQueryInformationProcess(ProcessConsoleHostProcess) and hook ONLY that process — unscoped hooks froze machines
- **What Windows does**: The console window belongs to conhost.exe (or openconsole/Windows Terminal's host), not to your process, so you can't get WM_SIZE. SetWinEventHook(EVENT_CONSOLE_LAYOUT) can observe it — but hooking with pid 0 (all processes) makes the system queue console events from EVERY process; many parallel console apps writing fast = event explosion = "complete machine hang". The conhost PID is available via the undocumented info class ProcessConsoleHostProcess (=49, src/win/winapi.h:4508-4509), whose return value carries flag bits in the low 2 bits — SetWinEventHook requires idProcess to be a real PID, so the value must be masked (`conhost_pid &= ~3`, tty.c:2380-2381).
- **How libuv handles it**: `uv__tty_console_resize_message_loop_thread` (tty.c:2359-2405): NtQueryInformationProcess on self; on failure (notably 32-bit process on 64-bit Windows, where the query fails) DON'T hook at all and rely solely on WINDOW_BUFFER_SIZE_EVENT records (TTY-50) — the original fallback of hooking pid 0 was removed because of the hang. Hook range EVENT_CONSOLE_LAYOUT..EVENT_CONSOLE_LAYOUT, WINEVENT_OUTOFCONTEXT.
- **History**: 6ad1e815 (libuv#1408, node#13197 — added SetWinEventHook); dabc737d (libuv#2308, 2019 — scope to conhost PID, machine-hang story); 7d950c0d (libuv#2381 — drop pid-0 fallback entirely, cites microsoft/terminal#1811/#410).
- **Bun disposition**: must-port (incl. the PID masking and the never-hook-pid-0 rule). Bun is x64/arm64-only so the 32-on-64 failure is unlikely but the query can still fail (e.g. no conhost when ConPTY-hosted? — keep the graceful bail). Target: win tty resize.

### [TTY-50] WINDOW_BUFFER_SIZE_EVENT in the raw input stream is the universal resize fallback
- **What Windows does**: With ENABLE_WINDOW_INPUT set (libuv's raw mode), the console posts WINDOW_BUFFER_SIZE_EVENT records into the input queue on buffer resize. Terminal emulators that don't run a real conhost (older ConEmu setups, some SSH/pty bridges) never fire EVENT_CONSOLE_LAYOUT but do post these records. Caveats: only arrives while reading raw input, and only on *buffer* size change (not window-only changes) — which is why the hook is preferred.
- **How libuv handles it**: The raw drain loop routes any WINDOW_BUFFER_SIZE_EVENT to `uv__tty_console_signal_resize()` (tty.c:781-785, comment: "We might be not subscribed to EVENT_CONSOLE_LAYOUT or we might be running under some TTY emulator that does not send those events"). Both paths converge on the same compare-and-dispatch (TTY-51).
- **History**: 564e7c76 (2012, original SIGWINCH via these records); 6ad1e815 removed it; 7d950c0d partially reverted #1408 to restore it as fallback.
- **Bun disposition**: must-port (belt-and-suspenders: hook + record fallback). Target: win tty resize.

### [TTY-51] Resize plumbing: hook thread needs a message PUMP; watcher thread debounces at 33ms; ResetEvent BEFORE reading state
- **What Windows does**: WINEVENT_OUTOFCONTEXT hook callbacks are delivered via the registering thread's message queue — no GetMessage loop, no callbacks. EVENT_CONSOLE_LAYOUT fires very frequently during interactive resizing (every pixel), and GetConsoleScreenBufferInfo per event is expensive system-wide.
- **How libuv handles it**: Thread 1 (message loop, tty.c:2400-2404): registers the hook then spins GetMessage/Translate/Dispatch forever. The hook callback only does `SetEvent(uv__tty_console_resized)` (tty.c:2407-2415). Thread 2 (watcher, tty.c:2417-2426): loop { Sleep(33) — "make sure to not overwhelm the system", ~30Hz max; WaitForSingleObject(event, INFINITE); ResetEvent; signal_resize() }. The ResetEvent was moved BEFORE the size check in 2024: resetting after meant an event set during signal_resize() was wiped, losing the final resize of a rapid burst (data race, libuv#4488). `uv__tty_console_signal_resize` (tty.c:2428-2447) re-queries the size, compares against the cached w/h under `uv__tty_console_resize_mutex`, and only on change dispatches SIGWINCH.
- **History**: 7d950c0d (debounce thread + 33ms, libuv#2381); a6a987c0 (ResetEvent ordering, libuv#4488/discussion#4485).
- **Bun disposition**: must-port (pump requirement is non-obvious and silently fatal; debounce + reset-before-read ordering both have scars). Target: win tty resize.

### [TTY-52] SIGWINCH is dispatched from an arbitrary background thread
- **What Windows does**: There is no SIGWINCH; libuv synthesizes it.
- **How libuv handles it**: `uv__signal_dispatch(SIGWINCH)` called from the watcher thread or the loop thread (record fallback) (tty.c:2443); the signal subsystem's dispatch is thread-safe by design (src/win/signal.c:80).
- **History**: 564e7c76 (2012).
- **Bun disposition**: must-port; cross-ref: SIGNALS (Bun's process.on('SIGWINCH') / stdout 'resize' event needs a thread-safe dispatch into the JS loop). Target: win tty resize → signals.

### [TTY-53] GetProcAddress-guard SetWinEventHook and NtQueryInformationProcess at startup
- **What Windows does**: SetWinEventHook lives in user32.dll, absent on Server Core/nano contexts; ntdll's NtQueryInformationProcess is undocumented. Loading them lazily from a worker thread caused crashes (node#16603) — loader lock + first-call-from-pool-thread hazards.
- **How libuv handles it**: Pointers resolved once in winapi init: pNtQueryInformationProcess is FATAL if missing (src/win/winapi.c:130-134), pSetWinEventHook is optional — `GetModuleHandleW(L"user32.dll")` (note: GetModuleHandle, not LoadLibrary — only if already loaded) (src/win/winapi.c:155-158); the resize thread bails if either is NULL (tty.c:2364-2365).
- **History**: e7f4e9ec (node#16603, 2017).
- **Bun disposition**: should-port (Bun targets desktop/server SKUs where user32 exists, but the resolve-once-at-init pattern and graceful no-resize degradation should be kept; linking user32 statically pulls a GUI dependency into a console app — decide consciously). Target: win sys dynload.

### [TTY-54] Old-SDK / old-compiler shims in tty.c
- **What Windows does**: Old SDKs lacked COMMON_LVB_REVERSE_VIDEO, ENABLE_VIRTUAL_TERMINAL_PROCESSING (0x0004), ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200); MSVC2008 lacked the InterlockedOr macro.
- **How libuv handles it**: `#ifndef` fallback defines (tty.c:28-30, 58-63, 38-40).
- **History**: 36a024de (XP/VS2008 build fix, 2016); 61ecb341.
- **Bun disposition**: skip (Bun builds with a modern SDK; the *values* 0x0004/0x0200/0x4000 are stable constants worth keeping in Bun's win32 bindings). Target: n/a.

### [TTY-55] Per-iteration UV_HANDLE_READING checks and DECREASE_ACTIVE_COUNT discipline on every error exit
- **What Windows does**: n/a — re-entrancy: read_cb may call uv_read_stop/uv_close synchronously.
- **How libuv handles it**: The raw drain loop conditions on `handle->flags & UV_HANDLE_READING` at the top of every iteration (tty.c:764-765) and before each emit; every error path clears READING, decrements the active count exactly once, and reports via read_cb with the translated error (tty.c:738-757, 876-883). After the drain, re-queue only if still READING and not READ_PENDING (tty.c:964-969).
- **History**: 8a99762c ("fix case where uv_read_start incorrectly reports failure", 2012) and general evolution.
- **Bun disposition**: must-port (the reentrancy contract: user callback can stop/close mid-drain and the loop must notice immediately). Target: win tty read raw.

### [TTY-56] Cross-area: console handles cannot use IOCP/overlapped I/O at all
- **What Windows does**: Console handles do not support FILE_FLAG_OVERLAPPED semantics; ReadFile/WriteFile on them are always synchronous and they cannot be associated with an IOCP.
- **How libuv handles it**: The entire architecture of this file is the workaround: RegisterWaitForSingleObject for raw readiness (TTY-25), a worker thread for cooked reads (TTY-35), synchronous writes with deferred completions (TTY-24). Nothing in tty.c ever touches the loop's IOCP except via POST_COMPLETION_FOR_REQ (manual PostQueuedCompletionStatus).
- **History**: foundational (622eb991); the "stdio over non-overlapped pipes" sibling problem is 54982a23 (cross-ref: PIPES area).
- **Bun disposition**: must-port as an architectural constraint of Bun's Windows loop: tty completions are *injected* into the IOCP, never native. Target: Phase 1 loop / win tty.

---

## Tally
- Total quirks: 56
- must-port (44): TTY-01, 02, 03, 04, 05, 06, 07, 08, 10, 12, 13, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 55, 56
- should-port (10): TTY-09, 11, 14, 17, 18, 19, 20, 21, 22, 53
- skip (2): TTY-41 (the len==0 discrimination hack only — replace with an explicit enum; the one-outstanding-read invariant is kept), TTY-54 (old-SDK/MSVC2008 shims — modern toolchain; keep the constant values)
