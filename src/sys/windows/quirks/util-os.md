# libuv Windows institutional knowledge — area: util-os

Scope: `src/win/util.c`, `src/win/winapi.c`, `src/win/winapi.h` in C:/Users/dylan/code/libuv-read (read at v1.52-era HEAD, full git history mined).
Bun baseline: Windows 10 1809+. Dispositions: must-port / should-port / skip — nothing silently dropped.

---

### [OS-01] Resolve a fixed table of NT/optional APIs once at process init, before anything else runs

- **What Windows does**: Several load-bearing APIs are either undocumented ntdll exports (no import library guarantees across SDKs), exist only on newer builds, or live in DLLs you don't want to import statically. Calling them requires runtime GetProcAddress.
- **How libuv handles it**: `uv__winapi_init()` (winapi.c:54-173) resolves everything exactly once, stored in global `p*` function pointers. It is the FIRST thing `uv__init()` runs ("must be done first because other initialization code might need these function pointers" — core.c:202-205), before winsock, fs, console, util init. Probed today: 9 ntdll functions, PowerRegisterSuspendResumeNotification (powrprof), ProcessPrng (bcryptprimitives), SetWinEventHook (user32), GetHostNameW (ws2_32), GetFileInformationByName (api-ms-win-core-file-l2-1-4.dll).
- **History**: a2ee4854 (2011, first ntdll dynamic loads), 87f3530a (NtQuerySystemInformation), e7f4e9ec (SetWinEventHook), 7484ab25 (ProcessPrng, 2025), 4e310d0f (fast-stat API, 2024). The table has only ever grown for _optional/new_ APIs and shrunk when XP died (a7493d8a).
- **Bun disposition**: must-port (the pattern: one-time, ordered, before any consumer; Bun equivalent = lazy `std::sync::OnceLock` table or explicit init in Phase 1 loop bring-up). Target: engine

### [OS-02] ntdll APIs are a hard dependency — fail fast and loudly if missing; note the RtlGetVersion anomaly

- **What Windows does**: NtQueryInformationFile/NtSetInformationFile/NtDeviceIoControlFile/NtQueryVolumeInformationFile/NtQueryDirectoryFile/NtQuerySystemInformation/NtQueryInformationProcess/RtlNtStatusToDosError are "undocumented" but have been stable since NT4 and are required for pipes, fs, cpu_info, getppid, error mapping.
- **How libuv handles it**: each GetProcAddress result is checked and `uv_fatal_error()` aborts the process if NULL (winapi.c:88-134). Exception: `pRtlGetVersion` (winapi.c:85-86) has NO null check — it would crash later in uv_os_uname if absent (it never is; exists since Win2000). GetModuleHandleW(L"ntdll.dll") itself is fatal-checked.
- **History**: a2ee4854 introduced the pattern; the missing RtlGetVersion check is "code comment only" (an inconsistency, not a decision).
- **Bun disposition**: must-port (declare these as normal extern imports in Rust — ntdll.lib exists in modern SDKs/windows-sys, so the GetProcAddress dance is unnecessary for the always-present set; keep runtime probing ONLY for genuinely optional APIs). Target: `src/windows_sys/externs.rs`.

### [OS-03] Load auxiliary DLLs with LOAD_LIBRARY_SEARCH_SYSTEM32 — DLL-hijack hardening

- **What Windows does**: plain `LoadLibraryA("powrprof.dll")` searches the application directory and CWD before system32; a planted DLL gets code execution (worse when elevated).
- **How libuv handles it**: `LoadLibraryExA(name, NULL, LOAD_LIBRARY_SEARCH_SYSTEM32)` for powrprof.dll and bcryptprimitives.dll (winapi.c:136-152). Both are optional: failure just disables suspend-resume detection / falls back to RtlGenRandom.
- **History**: cf7f70c2 (#3395, 2021) — explicitly a security fix.
- **Bun disposition**: must-port (any runtime LoadLibrary in Bun must pass LOAD_LIBRARY_SEARCH_SYSTEM32; never bare LoadLibrary for system DLLs). Target: all Windows dynamic loading helpers, `src/sys/windows`.

### [OS-04] Probe-by-GetModuleHandle (not LoadLibrary) for user32 / ws2_32 / api-set DLLs, and why each is optional

- **What Windows does**: (a) SetWinEventHook is absent in some environments (Server Core/Nano without user32; old issue nodejs/node#16603); (b) GetHostNameW exists since Win8 but MinGW headers historically lacked the declaration so static linking broke builds (msys2/MINGW-packages#9667); (c) GetFileInformationByName lives in the `api-ms-win-core-file-l2-1-4.dll` API set, present only on Win11 24H2+.
- **How libuv handles it**: `GetModuleHandleW` + GetProcAddress, all NULL-tolerated (winapi.c:154-172). GetModuleHandle works because libuv already links user32/ws2_32 (import table), and returns NULL harmlessly for the not-present api-set. Consumers check the pointer: uv_os_gethostname returns UV_ENOSYS if pGetHostNameW NULL (util.c:1408-1409); tty falls back to all-process event hook if pSetWinEventHook NULL; fs falls back to handle-based stat if pGetFileInformationByName NULL.
- **History**: e7f4e9ec, 26b2e5db (#3340 — switched GetHostNameW from static to GetProcAddress purely for MinGW builds), 4e310d0f, 2545ffe7 (GetModuleHandleA→W).
- **Bun disposition**: must-port for the api-set fast-stat probe (cross-ref: FS area); skip for GetHostNameW probing (1809 always has it; Rust links it directly); should-port the "optional UI DLL" pattern for any user32 use (Bun may run in services/AppContainers where conhost interop differs). Target: engine

### [OS-05] Cast GetProcAddress results through a union, not a straight cast

- **What Windows does**: FARPROC → specific-signature function pointer casts trigger `-Wcast-function-type` (GCC/clang) and are UB-adjacent in pedantic C.
- **How libuv handles it**: a union of all target pointer types; write `u.proc`, read the typed member (winapi.c:62-78).
- **History**: 6f3199dd (#4834, 2025) — pure warning hygiene.
- **Bun disposition**: skip (Rust `std::mem::transmute` on `FARPROC`/`Option<unsafe extern "system" fn...>` is the idiom; no union needed). Reason: language-specific workaround.

### [OS-06] Strict one-time init ordering: winapi → winsock → fs → signals → console → util → wakeup-detect

- **What Windows does**: GetHostNameW fails with WSANOTINITIALISED before WSAStartup; console/tty init queries probed pointers; QPF caching must precede any hrtime call.
- **How libuv handles it**: `uv__init()` (core.c:178-223, observed) runs the sequence above under a once-guard; every public util entry point that might be called pre-loop (`uv_hrtime`, `uv_os_gethostname`, `uv_os_uname`, `uv_set_process_title`, `uv_cpu_info`) defensively calls `uv__once_init()` first (util.c:349, 397, 437, 459, 544, 1406, 1579). Note util.c:1406's comment: `uv__once_init(); /* Initialize winsock */` — gethostname depends on winsock init, an invisible cross-module ordering edge.
- **History**: long-standing; the per-API defensive `uv__once_init()` calls accreted as each API gained pre-loop callers.
- **Bun disposition**: must-port (Bun equivalent: every Windows util API must be safe to call before the event loop exists; WSAStartup-before-GetHostNameW is a real trap). Target: engine

### [OS-07] The Wine GQCSEx saga: removed fallback, partially reverted, finally removed again — decide your Wine policy explicitly

- **What Windows does**: Wine (≤ old versions) did not implement GetQueuedCompletionStatusEx; real Windows ≥ Vista always has it.
- **How libuv handles it**: fc263218 (2011) probed GQCSEx and kept a GQCS fallback poller; fd8d212a (2018) deleted the fallback ("all supported Windows have it"); 153ea114 (2018) PARTIALLY REVERTED that deletion specifically "to restore partial support for using libuv under Wine"; 6af08fb5 (2024) finally removed the probe again once Wine gained the API. Net lesson: libuv treated Wine as a supported-enough platform to revert a cleanup for six years.
- **History**: fc263218 → fd8d212a → 153ea114 (revert, PR #1963) → 6af08fb5. Cross-ref: LOOP area owns the poller itself.
- **Bun disposition**: should-port (policy, not code: Bun on Wine is a real user base — Wine ≥6 has GQCSEx, so calling it directly is fine, but record that choosing any NEW Windows API needs a "does Wine ≥ X have it?" check; uptime OS-12 and cpu OS-32 have concrete Wine notes). Target: cross-cutting / Phase 1 loop.

### [OS-08] Partial XP-style dynamic probing is worthless if even one symbol is hard-linked — all-or-nothing per OS floor

- **What Windows does**: the PE loader fails the whole process at startup if any import-table symbol is missing, regardless of how carefully other call sites probe at runtime.
- **How libuv handles it**: e318e001 reverted "win: add Windows XP support to uv_if_indextoname()" with the rationale: "It also can't possibly work because ReOpenFile() in src/win/fs.c is not weakly linked, so any executable that links libuv would simply fail to load on XP." Subsequently a7b16bfb deleted all XP version checks and a7493d8a deleted the remaining kernel32 GetProcAddress probes (SetFileCompletionNotificationModes, CreateSymbolicLinkW, GetFinalPathNameByHandleW) in one sweep.
- **History**: 17eaa956 → e318e001 (revert) → a7493d8a / a7b16bfb / fd8d212a / 13e8b15e / 98239224 (mass cleanup, 2018).
- **Bun disposition**: must-port as policy: Bun's floor is 1809 — link everything ≤1809 statically; runtime-probe ONLY >1809 APIs (GetFileInformationByName, GetTempPath2W…), and audit that no >1809 symbol ever lands in the import table. Target: cross-cutting build policy.

### [OS-09] uv_hrtime: cache QPF once, QPC per call, do the scaling in floating point — and the exact expression shape matters

- **What Windows does**: QueryPerformanceFrequency is constant per boot but its magnitude is arbitrary (10MHz typical post-Win10, 3.5MHz HPET, ~2.4GHz TSC-direct on some VMs, 24MHz ARM). `counter * 1e9 / freq` in 64-bit integers overflows for large counters/frequencies. QPC itself never fails on XP+ but libuv still checks.
- **How libuv handles it**: `uv__util_init` caches the frequency and fatals if QPF fails (util.c:80-94). `uv__hrtime` (util.c:464-483) computes `scaled_freq = (double)freq / scale; result = (double)counter / scaled_freq` with the comment "no guarantee about the order of magnitude... integer math could cause this computation to overflow. Therefore we resort to floating point math." QPC failure is uv_fatal_error, counter==0 asserted.
- **History**: three-act story. (1) #850 / 44ecaa7c (2013): integer multiply overflowed with large QPF → discontinuous hrtime; switched to doubles. (2) used `counter * (1.0/freq) * scale` reciprocal for years; (3) #1633 / 79674486 (2020): VS2019 builds produced wrong values ("probable compiler bug") → rearranged to division-by-scaled-frequency, reciprocal removed (the init comment "precompute its reciprocal" at util.c:86-88 is now stale and describes deleted code).
- **Bun disposition**: must-port the lesson, not the code: in Rust use u128 widening (`counter as u128 * 1_000_000_000 / freq as u128`) — exact, no double rounding (doubles lose ns precision once counter > 2^53), immune to both historical bugs. Target: `src/bun_core` hrtime / Phase 1 loop time source.

### [OS-10] Wall clock: GetSystemTimePreciseAsFileTime + the 1601→1970 epoch constant

- **What Windows does**: GetSystemTimeAsFileTime ticks at timer-interrupt granularity (~15.6ms); GetSystemTimePreciseAsFileTime (Win8+) gives <1µs wall time. FILETIME is 100ns units since 1601-01-01 UTC.
- **How libuv handles it**: `uv_clock_gettime(UV_CLOCK_REALTIME)` calls GetSystemTimePreciseAsFileTime directly (no probe — Win8+ assumed), subtracts `116444736000000000` (100ns ticks between 1601 and 1970), splits into sec + nsec (util.c:442-451). Snarky comment preserved: "In 100-nanosecond increments from 1601-01-01 UTC because why not?"
- **History**: c8a1e613 (#3971, fixes #1674 which had been open since 2017 asking for a real-time clock API).
- **Bun disposition**: must-port (use the Precise variant for Date.now()-grade APIs; keep the constant named). Target: `src/bun_core` time, `Date.now` glue.

### [OS-11] uv_gettimeofday deliberately uses the NON-precise clock — pick one and document it

- **What Windows does**: see OS-10; the imprecise variant is cheaper (no interpolation) but quantized to the timer interrupt.
- **How libuv handles it**: `uv_gettimeofday` (util.c:1724-1739) uses plain GetSystemTimeAsFileTime with the same epoch constant ("Based on https://doxygen.postgresql.org/gettimeofday_8c_source.html"), µs output. So libuv ships TWO wall clocks of different precision: clock_gettime(REALTIME) is precise, gettimeofday is not.
- **History**: 575d4148 (2019) predates uv_clock_gettime; never harmonized after c8a1e613.
- **Bun disposition**: must-port the decision (Bun should use the precise variant everywhere and NOT replicate the inconsistency); record so nobody "fixes" a perf regression by quietly downgrading precision. Target: `src/bun_core` time.

### [OS-12] uv_uptime: the perf-counter-registry monstrosity → GetTickCount64, with Wine as a tiebreaker

- **What Windows does**: system uptime is exposed via (a) the perf-data pseudo-registry `RegQueryValueExW(HKEY_PERFORMANCE_DATA, L"2")` System Up Time counter (index 674) — variable-size blob, grow-and-retry parsing, localization-independent only by numeric index; (b) GetTickCount64 (Vista+) — ms since boot, 64-bit, no wraparound, includes time asleep/hibernated.
- **How libuv handles it**: today just `*uptime = GetTickCount64() / 1000.0` (util.c:502-505). The old perf-data implementation (deleted in d0e500c8) had: doubling buffer capped at 1MB, "PERF" signature check, counter-674 search, PERF_OBJECT_TIMER validation — ~100 lines.
- **History**: GetTickCount (32-bit, wraps 49.7 days) → 442aa1f4 switched to perf counters to dodge the wrap → 21bcaceb fixed a double-free in that parser → 50c1d008 (#3447) made it fractional → d0e500c8 (2022) reverted to GetTickCount64: "performance counters were 6 seconds behind... The old code also did not work on Wine-5.0 (data_size == HeaderLength, no data present)."
- **Bun disposition**: must-port (GetTickCount64/1000.0, full stop; never touch HKEY_PERFORMANCE_DATA). Target: `node:os` uptime.

### [OS-13] System sleep silently freezes GQCS timeouts — register a suspend/resume callback to re-arm timers

- **What Windows does**: a GetQueuedCompletionStatus wait does not get its timeout credited for time spent suspended; after resume, timers fire late by the sleep duration. PowerRegisterSuspendResumeNotification(DEVICE_NOTIFY_CALLBACK) delivers PBT_APMRESUMEAUTOMATIC/PBT_APMRESUMESUSPEND callbacks without needing a window message pump.
- **How libuv handles it**: probed pPowerRegisterSuspendResumeNotification (winapi.c:136-144, NULL-tolerated); detect-wakeup.c registers a callback that pokes every loop to re-evaluate timers. Constants PBT_APMRESUMEAUTOMATIC=18, PBT_APMRESUMESUSPEND=7, DEVICE_NOTIFY_CALLBACK=2 hand-defined in winapi.h:4728-4739 for old SDKs.
- **History**: 6fa3524e (#962, fixes nodejs/node#6763 "setTimeout fires hours late after laptop sleep").
- **Bun disposition**: must-port (cross-ref: LOOP — the consumer is the timer subsystem, but the probe + constants live here). Target: engine

### [OS-14] uv_exepath: GetModuleFileNameW into a ≤32768-WCHAR buffer; know the truncation semantics; the XP NUL workaround caused an off-by-one

- **What Windows does**: GetModuleFileNameW truncates silently when the buffer is too small (returns nSize, sets ERROR_INSUFFICIENT_BUFFER on Vista+; XP additionally failed to NUL-terminate). Win32 paths can never exceed 32767 WCHARs + NUL.
- **How libuv handles it**: allocates a UTF-16 buffer sized from the caller's byte budget, clamped to 32768 ("Windows paths can never be longer than this", util.c:106-111); converts to WTF-8 with ENOBUFS→silent-truncate semantics (util.c:126-132). It does NOT loop/grow and does NOT detect GetModuleFileNameW truncation — a caller passing a tiny buffer gets a silently truncated path.
- **History**: df0ac426 (#3691, 2022): for years the code wrote `utf16_buffer[utf16_len] = L'\0'` — one PAST the buffer end when truncated — and the commit reveals the write existed only as "a workaround for a bug in the Windows XP version of GetModuleFileName()". uv_cwd had the same planted bug.
- **Bun disposition**: must-port (grow-and-retry GetModuleFileNameW until return < capacity, cap 32768; don't trust the single-shot pattern). Target: `process.execPath`, `src/sys/windows`.

### [OS-15] uv_cwd: GetCurrentDirectoryW's size protocol is racy — loop until a coherent pair of calls

- **What Windows does**: GetCurrentDirectoryW(0,NULL) returns required size INCLUDING the NUL; GetCurrentDirectoryW(n,buf) returns length EXCLUDING the NUL on success, or required-size-including-NUL if the buffer became too small. Another thread can SetCurrentDirectory between the two calls, and the buffer contents are undefined in the too-small case.
- **How libuv handles it**: `uv__cwd` (util.c:144-186) loops: alloc t, call, and only accept when `n > 0 && n < t`; on `n >= t` it frees and retries with t=n. Comment block at util.c:159-163 documents the exact n/t semantics.
- **History**: 4db0a9a6 (#3708, 2022) "Another thread can change the working directory between calls... Retry if the reported size does not match the expected size because the buffer's contents is undefined in that case."
- **Bun disposition**: must-port (identical retry loop; bun already wraps cwd in src/sys — verify loop semantics match `n>0 && n<t`). Target: `src/sys/windows` getcwd / `process.cwd()`.

### [OS-16] Strip exactly one trailing backslash from cwd/tmpdir — except at a drive root

- **What Windows does**: GetCurrentDirectoryW can return `C:\` (root, trailing slash is load-bearing) or `C:\foo\` (per some launchers); GetTempPathW ALWAYS appends a trailing backslash.
- **How libuv handles it**: shared idiom `if (p[len-1]==L'\\' && !(len==3 && p[1]==L':')) strip;` at util.c:173-180 (cwd) and util.c:1040-1046 (tmpdir). Note the root check is exactly `len==3 && p[1]==':'` — UNC roots (`\\server\share\`) are NOT exempted and get stripped.
- **History**: 422d2810 "make uv_cwd be consistent with uv_exepath" (2012); c0fa2e75 (tmpdir, 2016).
- **Bun disposition**: must-port (Node-observable: `os.tmpdir()` has no trailing slash, `process.cwd()` is `C:\` at root). Target: `node:os` tmpdir, `process.cwd`.

### [OS-17] uv_chdir must manually refresh the magic "=C:" per-drive hidden environment variable

- **What Windows does**: cmd.exe-compatible per-drive working directories are stored in hidden env vars literally named `=C:`, `=D:`, … (value e.g. `C:\Windows`). SetCurrentDirectoryW does NOT update them; child processes and drive-relative path resolution (`C:foo.txt`) consult them.
- **How libuv handles it**: after SetCurrentDirectoryW succeeds, re-reads the cwd via uv**cwd, derives the drive letter, uppercases it (`a-z` → `A-Z`, util.c:248-256), builds the 3-char name `=X:` and SetEnvironmentVariableW's it (util.c:230-266). UNC paths and anything without `X:` shape skip the update (with a live TODO: "Need to handle win32 namespaces like \\?\C:\ ?"). Quirk: if uv**cwd returns UV_ENOMEM after the chdir succeeded, uv_chdir returns 0 anyway — "We did successfully change current working directory, only updating hidden env variable failed" (util.c:234-239).
- **History**: 24f8a53f (2012, Bert Belder) introduced the env-var refresh; 780b40ea (#3912) fixed a leak (uv\_\_cwd always returns a fresh buffer; the utf16 input buffer had to be freed first); da7e50bb removed the MAX_PATH cap.
- **Bun disposition**: must-port (cmd-spawned children resolve `C:relative` paths via these; Node matches this. Uppercasing matters: cmd only recognizes uppercase forms). Target: `process.chdir` / `src/sys/windows`.

### [OS-18] No MAX_PATH buffers anywhere — Win10 1607 removed the limits, so size dynamically

- **What Windows does**: since Windows 10 1607 (with the longPathAware manifest + registry opt-in) many Win32 APIs accept paths >260; hard-coded MAX_PATH buffers truncate or fail for such paths.
- **How libuv handles it**: da7e50bb (#2788, 2020) systematically replaced fixed `WCHAR buf[MAX_PATH]` with query-size-then-alloc across uv_cwd/uv_chdir/getenv/tmpdir etc. Residual exception: `uv__get_process_title` still uses `WCHAR title_w[MAX_PATH]` (util.c:379) — acceptable because it's only a default title.
- **History**: da7e50bb; issue #2331.
- **Bun disposition**: must-port as policy (Bun ships a longPathAware manifest; every Windows path buffer must be growable; cross-ref FS area for \\?\ prefixing). Target: cross-cutting `src/paths`.

### [OS-19] uv_os_getenv: stack fast-path + retry loop because the variable can change size mid-read, and 32767 is a lie

- **What Windows does**: GetEnvironmentVariableW(name, buf, n) returns the value length EXCLUDING NUL if it fit, or required size INCLUDING NUL if it didn't. Docs claim env vars max out at 32767 chars — but real systems exceed it ("The Windows documentation states these should not be possible but several people have reported that they do in fact happen", #2587). Another thread can SetEnvironmentVariable between your size query and fetch.
- **How libuv handles it**: 512-WCHAR stack `fastvar` first; loop `for(;;)` re-calling while `len >= varlen`, reallocating to `1 + len` each time — explicitly commented "Try repeatedly because we might have been preempted by another thread modifying the environment variable just as we're trying to read it" (util.c:1301-1327).
- **History**: db96a61c (#2587/#2589, 2020) added the loop + >32767 support, replacing a single fixed allocation.
- **Bun disposition**: must-port (retry-until-stable loop; do not trust 32767). Target: `process.env` getter / `src/bun_core` env.

### [OS-20] Distinguishing "empty env var" from "not found" requires priming the thread-error slot — and read it immediately

- **What Windows does**: GetEnvironmentVariableW returns 0 BOTH for a missing variable (last error = ERROR_ENVVAR_NOT_FOUND) and for one set to the empty string (last error untouched!). Any intervening Win32 call can clobber the thread-local last error.
- **How libuv handles it**: `SetLastError(ERROR_SUCCESS)` immediately before the call; on len==0, `r = uv_translate_sys_error(GetLastError())` captured IMMEDIATELY inside the loop, before any free/alloc could clobber it (util.c:1305-1309). `uv_translate_sys_error(0)` returns 0 → empty var reads as success with empty value. ERROR_ENVVAR_NOT_FOUND maps to UV_ENOENT (error.c:136).
- **History**: 9e800570 (#2413/#2419, 2019) added the SetLastError prime; 46c0e176 (#4338/#4339, 2024) moved the GetLastError capture to immediately after the call: "Make it less likely for the thread-local error value to get clobbered between performing the operation and checking the result."
- **Bun disposition**: must-port (exact pattern; Rust: call SetLastError(0), then GetLastError() before ANY other winapi including the allocator's potential VirtualAlloc). Target: `src/bun_core` env / `process.env`.

### [OS-21] uv_os_environ: hidden "=C:"-style vars must be parsed name-inclusive (split on the SECOND '='), and GetEnvironmentStringsW can return NULL

- **What Windows does**: the environment block contains hidden entries whose NAMES start with '=' (`=C:=C:\dir`, `=ExitCode=...`); a naive split on the first '=' yields an empty name and corrupt value. GetEnvironmentStringsW can fail (returns NULL).
- **How libuv handles it**: iterates the double-NUL block; for each entry searches `strchr(buf + 1, '=')` — comment: "some special environment variables on Windows start with a = sign" (util.c:1245-1247) — so `=C:` entries are INCLUDED in the output with name `=C:` (NOT skipped); entries with no '=' beyond position 0 are skipped entirely. NULL from GetEnvironmentStringsW → returns 0 with an empty list (success, not error; util.c:1223-1225). Memory layout quirk: `envitem->value = ptr + 1` points INTO the name's allocation — freeing item->name frees both.
- **History**: 2480b615 (#2400/#2404) added the API; fd1502f5 (#2473, Anna Henningsen) fixed the hidden-var split; cd11c2b1 fixed the NULL check; 9640bc65 (#4960, Dec 2025) fixed the error-path loop freeing `[cnt]` instead of `[i]` — a use-after-scope/leak that survived 6 years.
- **Bun disposition**: must-port the buf+1 split (Bun must decide: Node's process.env hides `=X:` vars from enumeration but spawn must PASS THEM THROUGH to children — splitting them correctly is prerequisite for both); the value-aliases-name layout is skip (Rust owns strings separately). Target: `process.env` enumeration + `Bun.spawn` env block construction.

### [OS-22] setenv/unsetenv: SetEnvironmentVariableW with NULL deletes; empty string is a legal value

- **What Windows does**: `SetEnvironmentVariableW(name, NULL)` deletes; `(name, L"")` sets an empty value (distinct states). The CRT's \_putenv conflates them — avoid the CRT.
- **How libuv handles it**: uv_os_setenv / uv_os_unsetenv call the Win32 API directly, converting via WTF-8 (util.c:1347-1397). No validation that name lacks '='.
- **History**: ee02f60c (2016).
- **Bun disposition**: must-port (use Win32 not CRT so empty-string vars survive; keep Win32 env and CRT `environ` divergence in mind if any C dependency reads getenv()). Target: `process.env` setter.

### [OS-23] The \*size in/out protocol: ENOBUFS reports size INCLUDING the NUL, success reports length EXCLUDING it

- **What Windows does**: n/a — this is libuv's own contract, but it shapes every consumer above.
- **How libuv handles it**: `uv__copy_utf16_to_utf8` (util.c:1107-1123): if `*size==0` → compute and return needed-size+1 with UV_ENOBUFS; else reserve 1 for NUL, convert, on ENOBUFS add the 1 back. Uniform across cwd/exepath/getenv/tmpdir/homedir/hostname. Input validation harmonized: every buffer API does `buffer==NULL || size==NULL || *size==0 → UV_EINVAL` (c6d43bea).
- **History**: 2606ba22 (#690, 2015) "count null byte on UV_ENOBUFS"; c6d43bea (2024) harmonization.
- **Bun disposition**: skip the C protocol itself (Rust returns owned Strings) but must-port the off-by-one awareness when calling libuv-compat shims in `src/libuv_sys` / sys_uv.rs. Target: `src/sys/sys_uv.rs` interop.

### [OS-24] All conversions are WTF-8, not UTF-8 — Windows filenames/env/titles contain unpaired surrogates, and Win32 conversion APIs are 32-bit-length-limited

- **What Windows does**: NTFS names, env vars, and console titles are arbitrary u16 sequences (not necessarily valid UTF-16). WideCharToMultiByte with WC_ERR_INVALID_CHARS rejects them; without it, lone surrogates become U+FFFD — either way you can't round-trip. The native APIs also take `int` lengths (not 64-bit clean).
- **How libuv handles it**: custom `uv_utf16_to_wtf8` / `uv_wtf8_to_utf16` (src/strtok? no — src/idna.c area) used by every util.c conversion (util.c:1061-1097); commit f3889085 explains: "the Windows API with WideCharToMultiByte is fairly verbose... and because Windows is not 64-bit ready here, but this implementation is." Earlier era (f04d5fc3, 2016) had moved TO the native APIs; f3889085 (2023) moved back OFF them for WTF-8 fidelity.
- **History**: f04d5fc3 → f3889085 (#2970/#4021) — a full round trip; the WTF-8 decision is deliberate and tested.
- **Bun disposition**: must-port (Bun already has WTF-8 machinery in bun_core strings; the lesson is to NEVER route paths/env through lossy UTF-16↔UTF-8 validation — real Windows machines have lone surrogates in USERPROFILE and file names; CLAUDE.md already encodes this). Target: cross-cutting `src/bun_core` strings.

### [OS-25] getppid via NtQueryInformationProcess(ProcessBasicInformation).InheritedFromUniqueProcessId — fast, but PIDs recycle

- **What Windows does**: there is no documented GetParentProcessId; the PEB-adjacent PROCESS_BASIC_INFORMATION carries InheritedFromUniqueProcessId. The value is a snapshot: the parent may be dead and its PID reused.
- **How libuv handles it**: pNtQueryInformationProcess(GetCurrentProcess(), ProcessBasicInformation=0, ...) (util.c:318-332); -1 on failure. PROCESS_BASIC_INFORMATION hand-declared with Reserved fields (winapi.h:4483-4489).
- **History**: e8e6a8a5 (2017) originally used CreateToolhelp32Snapshot + Process32First loop (O(processes), allocates); 5cbc82e3 (#4514, 2024) switched to NtQueryInformationProcess "it's faster."
- **Bun disposition**: must-port (NtQueryInformationProcess directly; document the recycling caveat in process.ppid). Target: `process.ppid`.

### [OS-26] OS version via RtlGetVersion because GetVersionExW lies based on the app manifest

- **What Windows does**: since Win 8.1, GetVersionEx returns at most the version your manifest declares compatibility with (un-manifested apps see 6.2 forever). The kernel-mode RtlGetVersion (exported by ntdll) is exempt from compatibility shimming and always tells the truth.
- **How libuv handles it**: pRtlGetVersion probed at startup (winapi.c:85-86), used in uv_os_uname (util.c:1583) with szCSDVersion pre-cleared (util.c:1581) because RtlGetVersion may not write it.
- **History**: d4288bbe added uv_os_uname using RtlGetVersion from the start (referencing gnulib's uname); 31d91659 (#4486, 2024) removed the last GetVersionExW call elsewhere ("deprecated").
- **Bun disposition**: must-port (any Bun feature gate keyed on Windows build number must use RtlGetVersion or RtlVerifyVersionInfo, never GetVersionEx; Bun's manifest will otherwise freeze the number). Target: `node:os` release/version, feature gates in `src/sys/windows`.

### [OS-27] ProductName must be read from the 64-bit registry view — WOW64 redirection serves stale/wrong values to 32-bit readers

- **What Windows does**: a 32-bit process reading `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` is silently redirected to `SOFTWARE\WOW6432Node\...`, whose ProductName "sometimes differs from the 64-bit equivalent value and is inaccurate (e.g. 'Windows 10 Enterprise' while the 64-bit value accurately contains 'Windows 10 Pro')".
- **How libuv handles it**: RegOpenKeyExW with `KEY_QUERY_VALUE | KEY_WOW64_64KEY` (util.c:1587-1591); "safely ignored on 32-bit hosts".
- **History**: 66160d69 (#4191, 2023).
- **Bun disposition**: skip (Bun has no 32-bit Windows builds; KEY_WOW64_64KEY is a no-op for x64/arm64 processes) — but keep the flag anyway if code is shared, it is harmless. Target: `node:os` version.

### [OS-28] Windows 11 self-identifies as "Windows 10" in both version numbers and registry — patch by build number ≥ 22000

- **What Windows does**: Win11 kept dwMajorVersion=10 AND the registry ProductName still says "Windows 10 Pro" (Microsoft never updated it). The only reliable discriminator is dwBuildNumber ≥ 22000.
- **How libuv handles it**: after reading ProductName, if `dwMajorVersion==10 && dwBuildNumber>=22000` and the string starts with "Windows 10", it literally patches byte 9: `product_name_w[9] = '1'` → "Windows 11 ..." (util.c:1605-1619).
- **History**: 97dcdb19 (#3381, nodejs/node#40862, 2022).
- **Bun disposition**: must-port (os.version() in Node returns the patched string; users grep for "Windows 11"). Target: `node:os` version.

### [OS-29] uname machine-arch mapping: arm64 was missing until 2025; i386 gets a processor-level digit hack

- **What Windows does**: SYSTEM_INFO.wProcessorArchitecture enumerates AMD64/ARM64/INTEL/IA32_ON_WIN64/…; wProcessorLevel carries the family for x86.
- **How libuv handles it**: switch mapping to "x86_64"/"arm64"/"i386→i486/i586/i686 via `buffer->machine[1] = '0' + min(wProcessorLevel,6)`"/"i686" for WOW32, plus dead arms for MIPS/Alpha/PPC/SHX (util.c:1670-1712); unknown → "unknown". MINGW builds report sysname "MINGW32_NT-maj.min" instead of "Windows_NT" (util.c:1647-1656).
- **History**: d4288bbe (2018) initial table; 917c1ad1 (#4838, July 2025!) added ARM64 — for 7 years os.machine() returned "unknown" on Windows-on-ARM.
- **Bun disposition**: must-port (x86_64 + arm64 arms only; on an arm64 host an x64 Bun build sees PROCESSOR_ARCHITECTURE_AMD64 via emulation — match Node). Target: `node:os` machine/arch.

### [OS-30] Hostname: gethostname() is ANSI and garbles non-ASCII; use GetHostNameW — but only after WSAStartup

- **What Windows does**: classic winsock `gethostname()` returns the ANSI-codepage rendering of the computer name — mojibake for non-ASCII hostnames. GetHostNameW (Win8+/ws2_32) returns UTF-16. Both fail with WSANOTINITIALISED before WSAStartup. Errors come from WSAGetLastError, not GetLastError.
- **How libuv handles it**: `uv_os_gethostname` calls `uv__once_init()` explicitly to get winsock up, uses probed pGetHostNameW (ENOSYS if absent — MinGW-declaration story, OS-04), 256+1 buffer (UV_MAXHOSTNAMESIZE), WSAGetLastError → translate (util.c:1400-1415).
- **History**: d8cd08bd (2017, ANSI version); 95f88f47 (#3148/#3149, 2021): "return unicode string in char array. It will cause garbled code if the host name contains non ascii characters... Requires Windows 8 / Server 2012"; 26b2e5db made it a runtime probe for MinGW builds.
- **Bun disposition**: must-port (GetHostNameW + WSAStartup ordering + WSAGetLastError channel; link statically, no probe needed at 1809). Target: `node:os` hostname.

### [OS-31] Registry APIs return error codes directly — GetLastError() after RegOpenKeyEx is garbage

- **What Windows does**: Reg\* functions return LSTATUS; they do NOT set the thread last-error. Calling GetLastError() afterwards reads stale state — often 0 (success) → caller proceeds on garbage data.
- **How libuv handles it**: cpu_info and uname use the returned `err` from RegOpenKeyExW/RegQueryValueExW/RegGetValueW directly (util.c:589-617, 1587-1604).
- **History**: 0aa6de6d (#1811, 2018): "For systems which don't have one of the values GetLastError() can end up returning 0 to the caller, indicating success. The caller then assumes that the data is valid and can attempt to execute on garbage data."
- **Bun disposition**: must-port (Rust wrapper: registry calls must return their LSTATUS, never funnel through a generic GetLastError-based error helper). Target: `src/sys/windows` registry helpers.

### [OS-32] cpu_info times: NtQuerySystemInformation(SystemProcessorPerformanceInformation=8); sys time = KernelTime − IdleTime

- **What Windows does**: per-CPU times come from info class 8 (array of SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION, hand-declared winapi.h:4491-4501); units are 100ns. CRITICAL semantic trap: KernelTime INCLUDES IdleTime (the idle loop runs in kernel mode), and InterruptTime/DpcTime are also inside KernelTime. Failures are NTSTATUS — convert via RtlNtStatusToDosError, NOT GetLastError.
- **How libuv handles it**: `cpu_times.sys = (KernelTime - IdleTime)/10000` ms; user/idle/irq(InterruptTime) divided by 10000 to ms; nice always 0 (util.c:621-626). `assert(result_size == sppi_size)` — both sides are limited to the current processor group so they agree. Error path: `err = pRtlNtStatusToDosError(status)` (util.c:566-568).
- **History**: a9bce29f (2012 refactor) fixed: freeing uninitialized pointer, "Don't return a bogus error value when NtQuerySystemInformation fails. That function returns an NTSTATUS code instead of setting the last error", and out-param clobbering.
- **Bun disposition**: must-port (the KernelTime−IdleTime subtraction and the /10000 scale are exactly what `os.cpus()` consumers expect; >64-CPU machines only report the current group — same as Node; document). Target: `node:os` cpus.

### [OS-33] CPU speed/brand: per-CPU registry keys HARDWARE\DESCRIPTION\System\CentralProcessor\N, values ~MHz and ProcessorNameString

- **What Windows does**: there is no Win32 API for CPU model string/frequency; the bootloader-populated volatile registry keys are the de-facto source (also emulated by Wine). `~MHz` is a DWORD; ProcessorNameString a REG_SZ.
- **How libuv handles it**: loops cpu 0..N formatting the key path with `_snwprintf` (util.c:573-617); any registry failure aborts the whole uv_cpu_info with that error (no partial results, no fallback speed=0); brand converted with `cpu_brand_size / sizeof(WCHAR)` — RegQueryValueExW's returned byte count INCLUDES the trailing NUL, so the converted UTF-8 carries an embedded NUL byte (harmless for C consumers, sloppy for length-based ones).
- **History**: introduced ~2011; e2baa87b simplified key closing; error handling via 0aa6de6d.
- **Bun disposition**: must-port (same registry source; consider tolerating missing ~MHz (some VMs/ARM lack it) with speed=0 instead of failing everything — Node issue history shows hypervisors omitting values). Target: `node:os` cpus.

### [OS-34] available_parallelism: popcount of GetProcessAffinityMask — DWORD_PTR is 32-bit on x86 (shipped bug), >64 CPUs unsupported, multi-group returns 0

- **What Windows does**: GetProcessAffinityMask reflects cpuset-style restrictions (Docker --cpus, start /affinity, job objects) but only within ONE processor group (≤64 logical CPUs); on a process with threads in multiple groups it returns success with BOTH masks zero. GetSystemInfo.dwNumberOfProcessors is also group-local.
- **How libuv handles it**: popcount loop `for (i = 0; i < 8u * sizeof(procmask); i++)` (util.c:517-521); falls back to 1 if count==0 (covers both failure and the zero-mask multi-group case); TODO comment cites GetLogicalProcessorInformationEx and PR #3458 for >64-CPU support (util.c:514-516).
- **History**: f250c6c7 added the API (plain CPU count); 58dfb6c8 (#4520) switched to affinity mask "to estimate the available parallelism" under container limits; 5ff1fc72 (#4524, days later) fixed x86: the loop was hardcoded to 64 bits while DWORD_PTR is 32 — "it manifested itself as double counting online processors, presumably because the compiler emits a ROR instead of SHR."
- **Bun disposition**: must-port (affinity-mask popcount, `usize::count_ones()` sidesteps the width bug; floor at 1). should-port: also query GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) and take the max for >64-core servers — libuv's known gap. Target: `node:os` availableParallelism, thread-pool sizing.

### [OS-35] free/total memory via GlobalMemoryStatusEx returning 0 on failure; constrained-memory is a stub (0) and available aliases free — job-object queries are a libuv GAP

- **What Windows does**: GlobalMemoryStatusEx gives ullAvailPhys/ullTotalPhys; memory limits imposed by job objects (Windows containers, sandboxes) are visible only via QueryInformationJobObject(JobObjectExtendedLimitInformation / JOBOBJECT_MEMORY_USAGE_INFORMATION).
- **How libuv handles it**: uv*get_free_memory/uv_get_total_memory return 0 on API failure (not an error code; util.c:279-300); `uv_get_constrained_memory` returns 0 = "unknown" (util.c:303-305, c4e9657d implemented it Linux-only); `uv_get_available_memory` just returns free (988d225c). The winapi.h JOB_OBJECT_LIMIT*\* constants exist but only process.c uses them for spawn, never for memory queries.
- **History**: c4e9657d (#2286, 2019); 988d225c (#3754, 2022); 6f696542 fixed return values. No Windows job-object memory implementation was ever merged.
- **Bun disposition**: should-port a REAL implementation: query the process's job object memory limit for constrained-memory (Windows containers and AppContainer harnesses set it — relevant to Bun's own CI sandboxes); fall back to GlobalMemoryStatusEx. Record that returning 0 means "unknown" in Node semantics. Target: `node:os` freemem/totalmem, V8 heap sizing hints.

### [OS-36] RSS = WorkingSetSize via GetProcessMemoryInfo (psapi); maxrss = PeakWorkingSetSize in KB

- **What Windows does**: PROCESS_MEMORY_COUNTERS.WorkingSetSize is current resident; PeakWorkingSetSize lifetime peak; PageFaultCount counts ALL faults (soft+hard — Windows doesn't split them).
- **How libuv handles it**: uv_resident_set_memory (util.c:486-499); uv_getrusage maps ru_maxrss = PeakWorkingSetSize/1024 (KB, matching Linux's getrusage unit) and ru_majflt = PageFaultCount (overcounts vs POSIX "major" faults) (util.c:916-917).
- **History**: 6f17a617 (2016) added maxrss/pagefaults; da9a2b1d original getrusage.
- **Bun disposition**: must-port (process.memoryUsage().rss and process.resourceUsage() unit compatibility: KB for maxrss). Target: `process.memoryUsage` / `process.resourceUsage`.

### [OS-37] getrusage CPU times converted via FileTimeToSystemTime silently drop full DAYS past 24h; only 6 of 16 rusage fields are real

- **What Windows does**: GetProcessTimes returns kernel/user CPU as FILETIME durations (100ns ticks). FileTimeToSystemTime interprets them as dates-since-1601; wHour/wMinute/wSecond wrap at 24h with the excess going into wDay, which libuv ignores.
- **How libuv handles it**: `ru_utime.tv_sec = wHour*3600 + wMinute*60 + wSecond` (util.c:906-914) — a process that has consumed >24h of CPU reports time mod 24h. Populated fields: ru_utime, ru_stime, ru_majflt, ru_maxrss, ru_oublock/ru_inblock (= WriteOperationCount/ReadOperationCount from GetProcessIoCounters — operation COUNTS, not blocks); everything else memset to 0 (util.c:904).
- **History**: da9a2b1d (2012) original; a7dfee3b (2016) added I/O counts; the >24h truncation is "code comment only" (latent; division by 10 000 000 on the QuadPart would be exact).
- **Bun disposition**: must-port the field mapping/units for Node parity, but FIX the conversion (u64 QuadPart/10 → µs; no SYSTEMTIME) — do not inherit the 24h wrap. Target: `process.resourceUsage` / `process.cpuUsage`.

### [OS-38] getrusage_thread: GetThreadTimes(GetCurrentThread()) with the same SYSTEMTIME conversion (same 24h flaw), only utime/stime populated

- **What Windows does**: GetThreadTimes mirrors GetProcessTimes per-thread; pseudo-handle GetCurrentThread() needs no rights.
- **How libuv handles it**: util.c:926-963; memset rest to 0.
- **History**: be8eec8c (#4666, 2025; refs #3119).
- **Bun disposition**: should-port (used by worker_threads perf instrumentation; same conversion fix as OS-37). Target: `worker_threads` / `node:os`.

### [OS-39] GetAdaptersAddresses: grow-on-ERROR_BUFFER_OVERFLOW retry loop plus a four-way error remap (NO_DATA→empty success, ADDRESS_NOT_ASSOCIATED→EAGAIN, INVALID_PARAMETER→ENOBUFS)

- **What Windows does**: GetAdaptersAddresses wants a caller-sized buffer; the adapter set can grow between the size query and the fetch (hotplug, VPN up). Distinct failure modes: ERROR_NO_DATA (no adapters), ERROR_ADDRESS_NOT_ASSOCIATED (transient, DHCP still binding), ERROR_INVALID_PARAMETER (per MSDN also means "address information... greater than ULONG_MAX").
- **How libuv handles it**: infinite `for(;;)` loop re-calling while ERROR_BUFFER_OVERFLOW, reallocating to the reported size (util.c:675-734); flags `GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER` (util.c:667-668); NO_DATA → malloc(1) + count 0 + success; ADDRESS_NOT_ASSOCIATED → UV_EAGAIN; INVALID_PARAMETER → UV_ENOBUFS with the MSDN quote in a comment (util.c:717-726).
- **History**: 527a10f9 (2012) — before it, failure returned UV_OK with uninitialized out-params, adapters appearing mid-call failed the API, and OOM crashed via fatal error.
- **Bun disposition**: must-port (the retry loop and the NO_DATA/ADDRESS_NOT_ASSOCIATED remaps are observable in `os.networkInterfaces()` on machines mid-DHCP). Target: `node:os` networkInterfaces.

### [OS-40] Netmask derivation: NEVER walk FirstPrefix — use OnLinkPrefixLength (cast through IP_ADAPTER_UNICAST_ADDRESS_LH), and guard the <<32 UB

- **What Windows does**: the FirstPrefix list (a) can be NULL, (b) on Vista+ contains THREE prefixes per unicast address plus per-adapter multicast/broadcast entries, (c) is maintained as a separate unordered list with "no relationship" to the unicast list order (MSDN quote preserved in commit 68ac0a68). The Vista+ IP_ADAPTER_UNICAST_ADDRESS_LH struct carries OnLinkPrefixLength directly.
- **How libuv handles it**: `prefix_len = ((IP_ADAPTER_UNICAST_ADDRESS_LH*) unicast_address)->OnLinkPrefixLength` (util.c:816-817; the cast exists because old MinGW headers lacked the \_LH variant — 97bb41f3); IPv4 netmask `(prefix_len > 0) ? htonl(0xffffffff << (32 - prefix_len)) : 0` — the ternary avoids shifting by 32 (UB) for /0 (util.c:847-848); IPv6 fills whole bytes then `0xff << (8 - prefix_len % 8)` for the partial byte with an explicit bounds comment (util.c:835-841).
- **History**: 14aa6153 (added netmask via prefix-list walk) → 1d5c61a8 (simplified) → 68ac0a68 (2013, Chromium-inspired longest-match walk for XP correctness + crash fix) → a7b16bfb (2018, XP dead: deleted the walk, kept only OnLinkPrefixLength).
- **Bun disposition**: must-port (OnLinkPrefixLength only; both shift guards). Target: `node:os` networkInterfaces.

### [OS-41] Interface enumeration details: skip non-Up and address-less adapters, FriendlyName is localized text, loopback = IF_TYPE_SOFTWARE_LOOPBACK, MAC copied only when exactly 6 bytes, one flat allocation

- **What Windows does**: adapters appear in OperStatus≠Up states (unplugged ethernet, disabled wifi) and may carry no unicast address; FriendlyName is the user/locale-renamable name ("Ethernet", "Местная сеть"), not the GUID; PhysicalAddressLength varies (0 for loopback, 8 for some tunnels, 20 for Infiniband).
- **How libuv handles it**: two passes — first sizes (counts only OperStatus==IfOperStatusUp && FirstUnicastAddress!=NULL, util.c:750-752), then fills; FriendlyName → WTF-8 (util.c:793-804); `is_internal = (IfType == IF_TYPE_SOFTWARE_LOOPBACK)` (util.c:829-830); phys_addr memcpy'd only `if (PhysicalAddressLength == sizeof(uv_address->phys_addr))` i.e. exactly 6, else zeros (util.c:823-827); one uv_interface_address_t per unicast address (name repeated); structs and the name strings live in a single malloc'd block (names after the array, util.c:769-779).
- **History**: 527a10f9 (single heap area), e3a657c6 (MAC), 5fb95172 (2018 consistency: init out-params first, missing dealloc on error).
- **Bun disposition**: must-port semantics (Up-only filter, per-address duplication, localized names as WTF-8); skip the flat-allocation layout (Rust uses owned Vec/String). Target: `node:os` networkInterfaces.

### [OS-42] homedir: USERPROFILE env var wins, but values shorter than 3 chars are treated as unset; fallback is the token's profile directory (NOT shell32)

- **What Windows does**: USERPROFILE can be absent (services), empty, or garbage; the authoritative answer is GetUserProfileDirectoryW(process token) from userenv.dll. SHGetKnownFolderPath gives the same data but is Vista+, COM-adjacent and drags in shell32.
- **How libuv handles it**: uv_os_getenv("USERPROFILE") first; if found but `*size < 3` → UV_ENOENT ("USERPROFILE is empty or invalid", util.c:977-983 — len<3 because the shortest real path is `C:\`); only ENOENT falls through to uv_os_get_passwd → OpenProcessToken(TOKEN_READ) + double-call GetUserProfileDirectoryW sized via ERROR_INSUFFICIENT_BUFFER (util.c:1136-1161).
- **History**: a62c2d59 (2015, SHGetKnownFolderPath) → a0c88152 (switched to GetUserProfileDirectoryW "supported back to Windows 2000, and is not deprecated") → 502decd6 (USERPROFILE via uv_os_getenv) → 83306585 (#2328/#4464, 2024): "the Windows API doesn't return an error even if the path is empty" → the <3 check.
- **Bun disposition**: must-port (exact precedence and the <3 guard; Node's os.homedir() contract). Target: `node:os` homedir.

### [OS-43] tmpdir: GetTempPathW size-query protocol, <3 chars = ENOENT, strip the always-appended trailing slash; note GetTempPath2W is NOT used (libuv gap)

- **What Windows does**: GetTempPathW(0,NULL) returns required WCHARs incl. NUL; result always has a trailing `\`; it concatenates %TMP%/%TEMP%/%USERPROFILE% with NO validation (a bogus TMP propagates). Since Win11/Server2022, GetTempPath2W returns `C:\Windows\SystemTemp` for SYSTEM processes (hardening); newer SDKs alias GetTempPath→GetTempPath2 at compile time, but libuv pins the W1 form.
- **How libuv handles it**: size query then fetch (util.c:1016-1038); `len < 3` → UV_ENOENT (same empty/invalid rationale as homedir, 83306585); trailing-slash strip with drive-root exception (util.c:1040-1046); WTF-8 out.
- **History**: c0fa2e75 (2016); a5d37437 (#2341, 2019): exactly-MAX_PATH-length TMP caused spurious UV_EIO (off-by-one in fixed buffer era); da7e50bb removed MAX_PATH; f15c602b (#4680, 2025) fixed a leak; GetTempPath2W: never adopted ("code comment only" — Rust std switched in 1.61).
- **Bun disposition**: must-port (size-loop + strip + <3 guard); should-port GetTempPath2W-with-fallback probe (matches Rust std; only behavior change is for SYSTEM services, which Bun can run as). Target: `node:os` tmpdir / `src/sys/tmp.rs`.

### [OS-44] get_passwd: username via GetUserNameW with a UNLEN+1 buffer; uid/gid faked as -1, shell NULL; passwd2/group are ENOTSUP

- **What Windows does**: usernames cap at UNLEN (256, from lmcons.h — libuv's comment says iphlpapi.h, which is wrong but harmless); GetUserNameW's ERROR_INSUFFICIENT_BUFFER "should not be possible" with that buffer. There are no numeric uids/gids.
- **How libuv handles it**: util.c:1126-1196; uid/gid = -1, shell = NULL; uv_os_get_passwd2 (by-uid) and uv_os_get_group return UV_ENOTSUP on Windows (util.c:1204-1211).
- **History**: 217f81b6 (2016); 832ab902 buffer-size fix; 2f110a50 added passwd2 as Unix-only.
- **Bun disposition**: must-port (os.userInfo(): username/homedir real, uid/gid -1, shell null — exact Node parity). Target: `node:os` userInfo.

### [OS-45] Process priority: a 6-band nice↔priority-class table; pid 0 = pseudo-handle; ERROR_INVALID_PARAMETER from OpenProcess means ESRCH; use QUERY_LIMITED rights

- **What Windows does**: priority is a class, not a number. OpenProcess on a dead/nonexistent pid fails with ERROR_INVALID_PARAMETER (not a NOT_FOUND code). PROCESS_QUERY_LIMITED_INFORMATION succeeds across integrity levels where PROCESS_QUERY_INFORMATION fails. Setting REALTIME_PRIORITY_CLASS without SeIncreaseBasePriorityPrivilege silently degrades to HIGH (Windows behavior, unreported).
- **How libuv handles it**: get: REALTIME→-20(UV_PRIORITY_HIGHEST), HIGH→-14, ABOVE_NORMAL→-7, NORMAL→0, BELOW_NORMAL→10, else(IDLE)→19 (util.c:1456-1468). set: bands `<-14→REALTIME, <-7→HIGH, <0→ABOVE_NORMAL, <10→NORMAL, <19→BELOW_NORMAL, else IDLE` (util.c:1483-1497). uv\_\_get_handle maps pid==0 → GetCurrentProcess(), OpenProcess ERROR_INVALID_PARAMETER → UV_ESRCH (util.c:1418-1436); get uses PROCESS_QUERY_LIMITED_INFORMATION, set PROCESS_SET_INFORMATION.
- **History**: e57e0717 (#2035 era, 2018). The silent REALTIME→HIGH degrade is undocumented in libuv ("code comment only" — it simply doesn't check).
- **Bun disposition**: must-port (os.getPriority/setPriority parity incl. the exact band edges and ESRCH remap). Target: `node:os` get/setPriority.

### [OS-46] Thread priority: THREAD*PRIORITY*\* passthrough; ERROR_INVALID_HANDLE → ESRCH; unknown enum values silently succeed

- **What Windows does**: SetThreadPriority takes the small THREAD*PRIORITY*\* ints; GetThreadPriority's error sentinel is THREAD_PRIORITY_ERROR_RETURN; a closed/invalid thread handle yields ERROR_INVALID_HANDLE.
- **How libuv handles it**: direct switch mapping the five UV*THREAD_PRIORITY*\* levels (util.c:1530-1552); `default: return 0` — passing an out-of-range priority is a silent no-op success (deliberate? "code comment only"); ERROR_INVALID_HANDLE → UV_ESRCH (was EBADF until 2b76a4fa, 2025, harmonized with Unix).
- **History**: e135dfe1 (#4075, 2023); 2b76a4fa (#4782).
- **Bun disposition**: should-port (only if Bun exposes worker thread priorities; if so, prefer returning EINVAL for unknown values instead of the silent no-op). Target: `worker_threads` options.

### [OS-47] Process title: don't read the console title at all — default to the exe path; writes go to SetConsoleTitleW with a process-local cache under a lock

- **What Windows does**: the "console title" is a property of the conhost WINDOW shared by every process attached to that console — reading it returns whatever cmd.exe or another process last set ("Command Prompt - node"), GetConsoleTitleW fails when the supplied buffer is bigger than the actual max on old systems (the MAX_TITLE_LENGTH=8192 comment block, util.c:45-55: "MSDN tells us… smaller than 64K. However in practice it is much smaller… GetConsoleTitle fails when the buffer to be read into is bigger than the actual maximum length"), returns 0 BOTH for error and for a legit empty title, and under Windows Terminal/ssh there may be no meaningful title at all.
- **How libuv handles it**: uv_set_process_title: WTF-8→UTF-16, truncate at 8191+NUL, SetConsoleTitleW, then cache the string in `process_title` under a CRITICAL_SECTION (util.c:344-375). uv_get_process_title: if never set, populates the cache from **GetModuleFileNameW** (the exe path) — it no longer touches GetConsoleTitleW at all (util.c:378-387).
- **History**: ffb49220 (always leave crit section); 840a8c59 (stricter); 0d4f54f0 (#58695, Jun 2025) added SetLastError-priming to distinguish empty title from failure; 01f4f895 (Feb 2026, fixes #2667) gave up on GetConsoleTitleW entirely → exe path. Eight years from bug report to fix.
- **Bun disposition**: must-port the END state (process.title default = exe path; setter = SetConsoleTitleW + cached copy; never read back from the console). skip the GetConsoleTitleW empty/error dance (dead code now). Target: `process.title`.

### [OS-48] Randomness: ProcessPrng (bcryptprimitives) preferred, RtlGenRandom/SystemFunction036 via static advapi32 link as fallback — because LoadLibrary("advapi32") can FAIL in some processes, and bcrypt.dll's BCryptGenRandom was never trusted

- **What Windows does**: SystemFunction036 (RtlGenRandom) is the legacy stable CSPRNG export of advapi32 (declared only by its ordinal-ish name); ProcessPrng (Win8+, bcryptprimitives.dll) is the modern direct PRNG used by Chromium/Rust — documented to always succeed once the DLL is loaded; BCryptGenRandom (bcrypt.dll) has a heavier dependency chain that can fail in early-process/sandboxed contexts.
- **How libuv handles it**: `uv__random_winrandom` (util.c:1741-1752): try pProcessPrng if probed (LOAD_LIBRARY_SEARCH_SYSTEM32, optional); else `SystemFunction036(buf, len)` — declared by hand `extern BOOLEAN NTAPI SystemFunction036(...)` (util.c:66-67) and resolved through the static advapi32 import table; FALSE → UV_EIO; buflen==0 short-circuits success.
- **History**: 4ed2a78f (2019) probed RtlGenRandom via GetProcAddress(advapi32); 335e8a6d (2020, #2759): "At least two people have reported that LoadLibrary('advapi32.dll') fails in some configurations. Libuv already links against advapi32.dll so let's sidestep the issue by linking to RtlGenRandom() directly"; 7484ab25 (2025, refs PR #2762 comment thread) layered ProcessPrng on top. BCryptGenRandom: considered in #1055/#2347, never shipped on win.
- **Bun disposition**: must-port the ladder (ProcessPrng → RtlGenRandom; never BCryptGenRandom for bulk randomness; never LoadLibrary advapi32 at runtime). Note ULONG length param on SystemFunction036: chunk >4GB requests. Target: `crypto.getRandomValues` seed path / `src/runtime/crypto` RNG bootstrap.

### [OS-49] NTSTATUS_FROM_WIN32: the DDK's official macro is WRONG — embed win32 errors with WARNING severity (0x8007xxxx) so they round-trip through RtlNtStatusToDosError

- **What Windows does**: libuv smuggles win32 error codes through `OVERLAPPED.Internal` (where the kernel normally stores the operation's NTSTATUS). The DDK's NTSTATUS_FROM_WIN32 builds `0xC007xxxx` (ERROR severity); the kernel's own convention for FACILITY_NTWIN32-wrapped errors is `0x8007xxxx` (WARNING severity); RtlNtStatusToDosError and the NT_ERROR/NT_WARNING classifying macros behave differently between the two.
- **How libuv handles it**: winapi.h:4079-4086 `#undef`s any SDK definition and redefines with `ERROR_SEVERITY_WARNING`, comment: "This is not the NTSTATUS_FROM_WIN32 that the DDK provides, because the DDK got it wrong!" Consumed by SET_REQ_ERROR (req-inl.h:34-35); read back via GET_REQ_ERROR = pRtlNtStatusToDosError (req-inl.h:49-50).
- **History**: 12e689dc (2011, Bert Belder); related 0ded5d29 "fix improper treatment of real ntstatus codes as mapped win32 errors" and 6622c35b (ntstatus→winsock mapping).
- **Bun disposition**: must-port IF Bun reuses overlapped.Internal to carry synthesized errors (cross-ref: LOOP/req plumbing); otherwise should-port as documentation in the error-mapping layer. Target: engine

### [OS-50] Guard every NT constant/struct with #ifndef — MinGW, MSVC SDK, and DDK headers each define overlapping, drifting subsets

- **What Windows does**: NTSTATUS codes, FILE\_\* enums, reparse structs etc. appear inconsistently across MinGW-w64 versions, Windows SDK versions, and the DDK; double definition is a hard error, absence is a hard error.
- **How libuv handles it**: winapi.h is 4843 lines of `#ifndef X # define X ...` — ~600 NTSTATUS codes (lines 31-4077), all FSCTL*/IO_REPARSE_TAG*/JOB*OBJECT*/METHOD*/FILE*\*\_ACCESS constants, plus MinGW-specific patches: `__UNICODE_STRING_DEFINED` (4112-4114), local GetHostNameW typedef "mingw doesn't have this definition, so let's declare it here locally" (4837-4841), NTDDI_WIN11_ZN fallback define (4128-4130) gating FILE_STAT_BASIC_INFORMATION/FILE_INFO_BY_NAME_CLASS against NEWER SDKs that now ship them (4132-4151, 4796-4805).
- **History**: 120d9978 (NTSTATUS redefined under MinGW), 1f73bd40, ff3ab317 (VS2008), fc8cc42e/7552305d (MinGW), 26b2e5db.
- **Bun disposition**: skip the C preprocessor mechanics (Rust windows-sys crates own this), but must-port the awareness for the handful of NT items Bun hand-declares in `src/windows_sys/externs.rs`: anything not in windows-sys (FILE_STAT_BASIC_INFORMATION until recently, AppExecLink reparse layout) must be byte-compared against the SDK (see OS-51). Target: `src/windows_sys`.

### [OS-51] Hand-copied NT structs WILL have field-order bugs: FILE_STAT_BASIC_INFORMATION shipped with VolumeSerialNumber/FileId128 swapped for ~10 months

- **What Windows does**: FILE_STAT_BASIC_INFORMATION's true layout ends `...Reserved; LARGE_INTEGER VolumeSerialNumber; FILE_ID_128 FileId128;` (winapi.h:4134-4150, current). The struct only exists in very new SDKs (NTDDI_WIN11_ZN), so libuv transcribed it by hand.
- **How libuv handles it**: the original transcription in 4e310d0f (Jan 2024) put `FileId128` BEFORE `VolumeSerialNumber`; abe59d63 (Feb 2025) silently fixed the order. In between, the fast-stat path returned garbage volume serials / file IDs (st_dev/st_ino-adjacent fields) on Win11 24H2 — only when the api-set probe succeeded, making it environment-dependent and hard to bisect.
- **History**: 4e310d0f → abe59d63 ("win: fix order of FILE_STAT_BASIC_INFORMATION struct fields", no test added). Related: 72d9abcc uses the same struct for no-permission fstat.
- **Bun disposition**: must-port the lesson (cross-ref: FS/stat): for every hand-declared NT struct, add a static assertion comparing offsets/size against the SDK (offsetof checks in a build-time test on a machine with the new SDK), and prefer windows-sys definitions the moment they exist. Target: engine

### [OS-52] REPARSE_DATA_BUFFER needs THREE extra arms beyond the SDK basics: WSL Linux symlinks (0xA000001D) and Store AppExecLinks (0x8000001B), each with custom layouts

- **What Windows does**: symlink-like reparse points come in (at least) symlink (0xA000000C, has Flags + SYMLINK_FLAG_RELATIVE), mount point/junction, LX_SYMLINK (WSL: `ULONG Version; UCHAR PathBuffer[]` — UTF-8 payload, no offsets!), and APPEXECLINK (Store python.exe etc.: `ULONG StringCount; WCHAR StringList[]` — NUL-separated string table where entry 2 is the target exe).
- **How libuv handles it**: the union in winapi.h:4153-4185 declares SymbolicLinkReparseBuffer, LinuxSymbolicLinkReparseBuffer, MountPointReparseBuffer, GenericReparseBuffer, AppExecLinkReparseBuffer; tags at winapi.h:4586-4594. Consumers in fs.c (readlink/stat).
- **History**: tags accreted with WSL (2018+) and Store-alias support; cross-ref FS area for the parsing commits.
- **Bun disposition**: must-port (cross-ref: FS readlink/realpath/stat — Bun already hit AppExecLink for Store Python/node shims; declaration source-of-truth belongs in `src/windows_sys`). Target: engine

### [OS-53] FILE_INFORMATION_CLASS is an ordinal-sensitive enum transcribed to position 64+ — adding entries means counting, not just appending names

- **What Windows does**: NtQuery/SetInformationFile take an information-class ORDINAL; the enum has gaps-free sequential numbering where a miscount silently queries the wrong class (error STATUS_INVALID_INFO_CLASS at best, wrong data at worst).
- **How libuv handles it**: full 64-entry transcription (winapi.h:4195-4261) ending `FileDispositionInformationEx` with a citation comment to the MS Learn wdm.h page — the entry was appended decades after the original list and required transcribing all intermediate entries to make the ordinal land on 64. FILE_SYNCHRONOUS_IO_ALERT/NONALERT mode bits hand-defined (4392-4393).
- **History**: 7a322479 / 315d7001 (NtQueryDirectoryFile/NtQueryVolumeInformationFile enablement); FileDispositionInformationEx added with POSIX-delete support (cross-ref FS unlink).
- **Bun disposition**: must-port awareness (Bun's Rust side should take these from windows-sys where the ordinals are machine-generated; hand-add only with the explicit `= N` value, never bare append). Target: `src/windows_sys`.

### [OS-54] The constant menagerie winapi.h exists to serve — map each to its consumer before porting piecemeal

- **What Windows does / how libuv handles it**: JOB*OBJECT_LIMIT_BREAKAWAY_OK/SILENT_BREAKAWAY_OK/DIE_ON_UNHANDLED_EXCEPTION/KILL_ON_JOB_CLOSE (4088-4105) → process.c spawn job-object containment; SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE (4107-4109) → fs symlinks under Developer Mode; FILE_SKIP_COMPLETION_PORT_ON_SUCCESS / FILE_SKIP_SET_EVENT_ON_HANDLE (4670-4676) → tcp/udp/pipe synchronous-completion fast path; ProcessConsoleHostProcess=49 (4508-4510) → tty conhost-pid lookup for the SetWinEventHook scoping that fixed the "tty event explosion machine hang" (dabc737d — listening to ALL processes' console events could hang the whole machine when many consoles wrote at once); ENABLE_INSERT/QUICK_EDIT/EXTENDED_FLAGS (4683-4693) → tty (QuickEdit freezes apps when the user selects text); ERROR_ELEVATION_REQUIRED=740 (4696-4698) → error.c → UV_EACCES (spawning a UAC-manifested exe); ERROR_SYMLINK_NOT_SUPPORTED=1464 → fs/error.c UV_EINVAL; ERROR_MUI_FILE_NOT_FOUND..15105 (4704-4726) → dl.c uv_dlerror FormatMessage language fallback (4272e0a6: non-English systems without the MUI pack make FormatMessageW fail; retry with default language); TCP_INITIAL_RTO_PARAMETERS + TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS ((UCHAR)-2) + SIO_TCP_INITIAL_RTO (4782-4793) → tcp.c connect-cancellation trick; PBT*\* → detect-wakeup.
- **History**: each constant arrived with its feature; the header is a dependency ledger.
- **Bun disposition**: must-port the MAP (each constant ports with its owning area: process/tty/tcp/fs/dl). cross-ref: PROCESS, TTY, TCP, FS, DL areas. Recording here so none is orphaned. Target: respective phase modules.

### [OS-55] Include order is load-bearing: winsock2.h before windows.h, and clang-format must not reorder

- **What Windows does**: windows.h pulls in legacy winsock.h unless WIN32_LEAN_AND_MEAN or winsock2.h precedes it; mixing the two breaks compilation with cryptic redefinitions. psapi/iphlpapi/tlhelp32 have their own ordering constraints vs windows.h.
- **How libuv handles it**: util.c:33-41 wraps the block in `/* clang-format off */ ... /* clang-format on */` with the exact order sysinfoapi → winsock2 → winperf → iphlpapi → psapi → tlhelp32 → windows.h.
- **History**: cc506dd9 "win,nfc: disable clang-format for #include order" — someone's formatter broke the build.
- **Bun disposition**: skip for Rust (windows-sys has no such constraint) but must-port for Bun's C++ JSC bindings touching winsock (keep the discipline + comment where applicable). Target: C++ bindings hygiene.

### [OS-56] APIs that are deliberate stubs on Windows — return the documented "unsupported" shape, don't invent data

- **What Windows does**: there is no load average; no numeric uid/gid namespace usable for get_passwd2/get_group lookups.
- **How libuv handles it**: uv_loadavg writes {0,0,0} with comment "Can't be implemented" (util.c:273-276); uv_os_get_passwd2 / uv_os_get_group → UV_ENOTSUP (util.c:1204-1211); uv_setup_args/uv\_\_process_title_cleanup are passthrough no-ops on Windows (util.c:335-341); uv_sleep = Sleep(msec) (util.c:1754-1756).
- **History**: original implementations; never changed.
- **Bun disposition**: must-port (os.loadavg() = [0,0,0] is Node-observable on Windows; do not synthesize from CPU usage). Target: `node:os` loadavg.

### [OS-57] uv_get_free/total_memory return 0 on API failure rather than erroring — callers treat 0 as "unknown"

- **What Windows does**: GlobalMemoryStatusEx virtually never fails, but the dwLength member MUST be set before the call or it fails with ERROR_INVALID_PARAMETER.
- **How libuv handles it**: sets `memory_status.dwLength = sizeof(...)` then returns 0 on failure (util.c:279-300) — the API contract has no error channel (returns uint64_t).
- **History**: 6f696542 "fix return value of memory functions" standardized the 0-on-failure convention.
- **Bun disposition**: must-port (dwLength-before-call is the classic footgun for any \*Ex info struct: MEMORYSTATUSEX, OSVERSIONINFOW.dwOSVersionInfoSize — same pattern at util.c:1580). Target: `node:os` freemem/totalmem.

---

## Tally

Counting rule: each entry counts once under its FIRST/primary disposition. Several must-port entries carry secondary partial-skip or should-port notes inline (e.g. OS-04's GetHostNameW probe, OS-43's GetTempPath2W).

- Total quirks: 57
- must-port: 48
- should-port: 4 (OS-07 Wine policy, OS-35 job-object memory, OS-38 thread rusage, OS-46 thread priority)
- skip: 5 (OS-05 union casts — Rust transmute idiom; OS-23 C size-protocol — Rust owned strings; OS-27 KEY_WOW64_64KEY — no 32-bit Bun builds; OS-50 #ifndef header mechanics — windows-sys owns it; OS-55 C include order — Rust-side N/A, C++ note retained)
