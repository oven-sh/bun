# libuv Windows institutional knowledge — process area

Sources: `src/win/process.c`, `src/win/process-stdio.c` in C:/Users/dylan/code/libuv-read (v1.x @ 439a54be, v1.52.1-42). Supporting refs: `src/win/error.c` (spawn errno mapping), `src/win/handle-inl.h` (CRT fd helpers), `src/win/pipe.c` (stdio pipe pair), `test/test-spawn.c` (pinned behaviors). All line refs are into the worktree at that revision.

---

### [PROC-01] Quote arguments with the MS CRT reverse-construction algorithm

- **What Windows does**: CreateProcessW takes ONE command-line string; each child's CRT re-splits it with `parse_cmdline` rules: backslashes are literal EXCEPT when they precede a `"`, in which case 2N backslashes + quote = N backslashes + quote-toggle, 2N+1 backslashes + quote = N backslashes + literal quote. A naive "escape every backslash" encoder corrupts paths like `C:\dir\`.
- **How libuv handles it**: `quote_cmd_arg` (process.c:448-518) builds the quoted form BACKWARDS from the last char with a `quote_hit` flag: copy char; if char is `\` and we are still in the shadow of a quote (or the closing quote), emit an extra `\`; if char is `"`, emit `\` and set `quote_hit`. Then `_wcsrev` reverses the buffer and wraps in quotes. Reverse construction is what makes "double only the backslashes that precede a quote (and the trailing run)" easy. Expected I/O table is in the comment at process.c:480-496 (note `hello world\` → `"hello world\\"`).
- **History**: d84b2496 (2011, Peter Bright) introduced the algorithm ("hopefully matches Windows' algorithm for unescaping"); 8658ef06 fixed the comment's trailing-backslash example which the code already handled correctly. `test/test-spawn.c:1150` (argument_escaping) round-trips through the REAL `CommandLineToArgvW` as the oracle.
- **Bun disposition**: must-port. Validate against CommandLineToArgvW in tests exactly like libuv does. Target: process.spawn (args encoding).

### [PROC-02] Empty argument must be emitted as `""`

- **What Windows does**: An empty argv entry vanishes entirely if you concatenate it bare; the child sees a shifted argv.
- **How libuv handles it**: `quote_cmd_arg` emits two quote chars for `len == 0` (process.c:454-459).
- **History**: 907b55e4 "process: adjust quote_cmd_arg for empty arguments" — originally empty args were silently SKIPPED.
- **Bun disposition**: must-port. Target: process.spawn (args encoding).

### [PROC-03] Quote only when needed; two fast paths before the full algorithm

- **What Windows does**: Quoting is only required for space/tab/quote; some old programs mis-parse unnecessary quotes.
- **How libuv handles it**: process.c:461-478: (1) if no char in `" \t\""` → copy verbatim, unquoted; (2) if no `"` or `\` present → simple wrap in quotes without escaping. Only otherwise run the reverse algorithm. Note the trigger set is space, tab, quote only — `&`, `|`, `^` etc. are NOT special (they only matter to cmd.exe, not to CreateProcess argv parsing).
- **History**: d84b2496; comment "it may only confuse older programs" dates to the original 2011 code.
- **Bun disposition**: must-port (behavioral compat: node's child_process output is bit-identical on the command line; some children parse GetCommandLineW themselves). Target: process.spawn (args encoding).

### [PROC-04] VERBATIM bypass: join args with spaces, zero escaping

- **What Windows does**: cmd.exe (`cmd /c ...`) and some programs (msiexec) parse their command line with NON-CRT rules; CRT-style quoting corrupts their arguments.
- **How libuv handles it**: `UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS` makes `make_program_args` (process.c:575-578) `wcscpy` each arg raw and join with single spaces — no quotes, no escapes, including args containing spaces. Caller takes full responsibility.
- **History**: d84b2496 "Support for unescaped arguments, suitable for use with cmd /c". Node exposes this as `windowsVerbatimArguments`, auto-set when spawning cmd.exe via `shell: true`.
- **Bun disposition**: must-port (Bun.spawn `windowsVerbatimArguments` + node:child_process compat both need it). Target: process.spawn (args encoding).

### [PROC-05] lpApplicationName is the resolved path; argv[0] stays what the caller passed

- **What Windows does**: CreateProcessW(lpApplicationName, lpCommandLine) runs lpApplicationName but the child's GetCommandLineW/argv comes ONLY from lpCommandLine. Passing only lpCommandLine makes Windows do its own (different, PATHEXT-less, current-dir-first) search and re-tokenization of unquoted spaced paths.
- **How libuv handles it**: uv_spawn always passes BOTH: `application_path` = result of its own `search_path`, `arguments` = quoted/verbatim join of options->args (process.c:1073-1082). So the child's argv[0] is `args[0]` as supplied, NOT the resolved absolute path — matches POSIX execvp semantics where argv[0] is caller-controlled.
- **History**: shape dates to the earliest code; the search/resolve split exists precisely so CreateProcess never does its own ambiguous parsing of lpCommandLine.
- **Bun disposition**: must-port (always pass lpApplicationName; never let CreateProcess parse the command line to find the exe — that is also the classic unquoted-path security hole). Target: process.spawn.

### [PROC-06] Args and env are WTF-8, not UTF-8

- **What Windows does**: Windows strings are UTF-16 and can contain lone surrogates (real filenames/env values do).
- **How libuv handles it**: `make_program_args` and `make_program_env` use `uv_wtf8_length_as_utf16`/`uv_wtf8_to_utf16` (process.c:535, 573, 664, 689), which round-trip lone surrogates instead of erroring or replacing. Negative return = invalid encoding propagates as the spawn error.
- **History**: f3889085 "misc: export WTF8 conversion utilities" (2023) formalized this; environment_creation test pins surrogate-pair and BMP-edge conversions (test-spawn.c:1235).
- **Bun disposition**: must-port (JSC strings are WTF-16; Bun must carry lone surrogates through spawn without mangling). Target: process.spawn (string conversion).

### [PROC-07] Env block: contiguous double-NUL block + CREATE_UNICODE_ENVIRONMENT

- **What Windows does**: CreateProcessW's lpEnvironment is a single block of NUL-terminated `NAME=value` WCHAR strings with an extra trailing NUL; without `CREATE_UNICODE_ENVIRONMENT` it is interpreted as ANSI and the child gets mojibake.
- **How libuv handles it**: `make_program_env` builds the block (process.c:645-777, final NUL at 770-772); `CREATE_UNICODE_ENVIRONMENT` is unconditionally in process_flags (process.c:1038). Empty caller env produces a 1-WCHAR block containing a single L'\0' — technically shorter than the documented "four zero bytes" but accepted by Windows.
- **History**: original 2011 code; 1fc72276 fixed UV_ENOMEM when env was empty after uv\_\_malloc(0) started returning NULL (nodejs/node#29008) — the `(1+env_len)` is that fix.
- **Bun disposition**: must-port (including the flag; forgetting CREATE_UNICODE_ENVIRONMENT is a classic from-scratch bug). Target: process.env-block.

### [PROC-08] Inject required env vars or children break (SYSTEMROOT kills winsock)

- **What Windows does**: Several undocumented-but-load-bearing env vars must exist in a child's environment: winsock `WSAStartup` fails without `SYSTEMROOT`; DLL loading, temp files, and credential lookups consult others. A user-supplied "clean" env silently produces bizarre child failures.
- **How libuv handles it**: `required_vars[]` (process.c:50-62, "keep me sorted"): HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR. Any of these missing from the user block is copied from the PARENT's live environment during the merge pass (process.c:700-768).
- **History**: 3409c9b3 (2011) added SYSTEMROOT/SYSTEMDRIVE/TEMP with the winsock rationale in the comment (process.c:634-638); 2ce14cfa (2014) added the other eight, citing Cygwin's environ.cc as the authority (comment at process.c:640-642).
- **Bun disposition**: must-port, same list. Node-compat: node passes `options.env` straight to libuv and relies on this injection. Target: process.env-block.

### [PROC-09] Required var missing from the parent too → skip silently, don't fail

- **What Windows does**: e.g. LOGONSERVER does not exist in service sessions or containers.
- **How libuv handles it**: `GetEnvironmentVariableW(name, NULL, 0) == 0` → var contributes nothing, no error (process.c:712-718, 746-749).
- **History**: 2ce14cfa — the first version of the expanded list FAILED the spawn when a var was absent from the parent; same commit changed it to skip. test pins it via `ZTHIS_ENV_VARIABLE_DOES_NOT_EXIST` (test-spawn.c:1278).
- **Bun disposition**: must-port. Target: process.env-block.

### [PROC-10] Env block MUST be sorted; sort key is CompareStringOrdinal, case-insensitive

- **What Windows does**: CreateProcess docs require the block "sorted alphabetically by name, case-insensitive, Unicode order, without regard to locale". An unsorted block makes the child's own GetEnvironmentVariableW lookups (binary search in some paths) misbehave, and breaks per-drive `=X:` semantics.
- **How libuv handles it**: UTF-16 copies of all entries are qsort'ed with `env_strncmp` → `CompareStringOrdinal(..., TRUE)` (process.c:600-626, 698). NOT `_wcsicmp` (locale/CRT-table-dependent), NOT lstrcmpiW (locale). Required-var injection is a sorted MERGE so the result stays ordered (process.c:726-768). Duplicate names from the caller are kept (qsort unstable, both copies land in the block) — dedupe is the embedder's job (node dedupes in JS).
- **History**: 8db42383 (2014) added sorting; 60bac5a9 (2018) — case-insensitivity bug: env vars differing only in case were mis-sorted, breaking child lookups (nodejs/node#20605). environment_creation test asserts pairwise `CompareStringOrdinal(prev, str) == CSTR_LESS_THAN`.
- **Bun disposition**: must-port exactly (CompareStringOrdinal with ignoreCase=TRUE; do NOT substitute a Rust unicode casefold — the OS's ordinal-uppercase table is the contract). Target: process.env-block.

### [PROC-11] Compare env names only up to '='; substring names must not collide

- **What Windows does**: `SYSTEM=ROOT`, `SYSTEMROOT=...`, `SYSTEMROOTED=OMG` are three distinct variables; naive prefix compare conflates them when checking "is SYSTEMROOT supplied?".
- **How libuv handles it**: `env_strncmp` derives each side's name length from its first `=` and compares name-only spans (process.c:600-619). The required_vars entries carry `wide_eq` (L"NAME=") + len so the same comparator works for both shapes.
- **History**: pinned deliberately in test-spawn.c:1239-1241 ("substring of a supplied var name" cases) since 8db42383.
- **Bun disposition**: must-port. Target: process.env-block.

### [PROC-12] Entries without '=' are dropped; leading-'=' hidden entries (=C:=...) pass through and sort first

- **What Windows does**: cmd.exe tracks per-drive working directories in hidden env vars named like `=C:` (value `C:\some\dir`), plus `=ExitCode`/`=::=::\`. Their names start with '='; they must survive into the child (sorted first) for cmd-style drive-relative cd semantics.
- **How libuv handles it**: filter is `strchr(*env, '=')` (process.c:663, 685) — finds the '=' at position 0, so `=C:=C:\dir` is KEPT; an entry with no '=' at all ("INVALID") is silently dropped. In `env_strncmp` a leading-'=' name yields name-length 0 which CompareStringOrdinal sorts before everything — the position Windows expects. libuv does NOT synthesize `=X:` entries for the cwd it passes (deviation from cmd.exe; harmless for non-cmd children).
- **History**: code-comment-free behavior, pinned by test (`"INVALID"`, `"BAZ"` dropped, test-spawn.c:1243/1246). The drop-no-'=' rule came with the 2011 code.
- **Bun disposition**: must-port the filter + pass-through; consider (like libuv) NOT synthesizing `=X:` entries. Target: process.env-block.

### [PROC-13] TOCTOU between sizing and fetching parent env vars → libuv aborts; do better

- **What Windows does**: Another thread can change an env var between the `GetEnvironmentVariableW(NULL,0)` size probe and the later fetch into the block.
- **How libuv handles it**: it doesn't — `if (var_size != (DWORD)(len - 1)) uv_fatal_error(...)` with a literal `/* TODO: handle race condition? */` (process.c:752-756). A concurrent SetEnvironmentVariable in the parent can ABORT the whole process.
- **History**: TODO comment present since 8db42383 (2014); never fixed.
- **Bun disposition**: must-port the lesson, not the abort: snapshot each required var ONCE into owned memory during the size pass (or use GetEnvironmentStringsW once). Target: process.env-block.

### [PROC-14] Child PATH search uses the CHILD's env, not the parent's

- **What Windows does**: nothing — this is pure semantics: POSIX execvp consults the environment the child will receive.
- **How libuv handles it**: `find_path(env)` scans the BUILT child block for `PATH=` case-insensitively with explicit per-char compare (process.c:785-797), i.e. after required-var injection (so an injected parent PATH also counts). Only when the caller passed no env does it read the parent's `%PATH%` (process.c:989-1009).
- **History**: c7e4b314 "windows: read the PATH env var of the child" — explicitly to converge with the unix implementation's semantics; 60bac5a9 made the `PATH=` match case-insensitive (`Path=` is the common real-world spelling!).
- **Bun disposition**: must-port (including case-insensitive match — almost every Windows machine has `Path`, not `PATH`). Target: process.path-search.

### [PROC-15] %PATH% may be entirely absent — spawn must still work

- **What Windows does**: PATH can legitimately be unset (sanitized service environments).
- **How libuv handles it**: if neither child env nor parent has PATH, `path` stays NULL and `search_path` simply searches cwd/explicit-dir only (process.c:991-1009; loop guards `dir_end == NULL` at 390).
- **History**: c97017dd "win,spawn: allow %PATH% to be unset" (#4116) — previously GetEnvironmentVariableW failure was treated as a spawn error.
- **Bun disposition**: must-port. Target: process.path-search.

### [PROC-16] Extension search is .com then .exe APPENDED — no PATHEXT, no replacement

- **What Windows does**: cmd.exe consults PATHEXT (.bat/.cmd/.vbs...), but CreateProcess can only start PE images (.com/.exe); .bat/.cmd require an explicit cmd.exe wrapper.
- **How libuv handles it**: `path_search_walk_ext` (process.c:246-285) tries, in order: literal name (only if it has a non-empty extension or EXACT_NAME flag), `name.com`, `name.exe`. Extensions are APPENDED, never substituted (`foo.bar` → tries `foo.bar`, `foo.bar.com`, `foo.bar.exe`). A name ending in '.' gets no extra dot (process.c:216-221). This deliberately equals msvcrt `_spawnvp` behavior, documented in the comment block process.c:288-331.
- **History**: 8ed2ffb2 (2011) "look only for .com and .exe files". The .com-before-.exe order matches cmd.exe precedence.
- **Bun disposition**: must-port (node-compat: `spawn('foo')` finds foo.exe but NOT foo.bat unless shell:true — silently changing this breaks/creates the BatBadBut-class vulnerability). Target: process.path-search.

### [PROC-17] Extension-less binaries need an explicit opt-in flag (EXACT_NAME)

- **What Windows does**: executables without any extension (common from MSYS/scoop shims) exist but trying bare names first would change 15 years of lookup precedence.
- **How libuv handles it**: `UV_PROCESS_WINDOWS_FILE_PATH_EXACT_NAME` (1<<7). Subtlety: the flag is only honored when the file spec CONTAINS a directory component (process.c:370-376); for a bare `foo` in PATH search the literal try still requires `name_has_ext` (process.c:378-437 passes only `name_has_ext`). `name_has_ext` itself means "has a dot with something after it" (process.c:366-368).
- **History**: 3f7191e5 (#4292, for CMake/Kitware). Commit message: defaulting it on was "deemed potentially breaking".
- **Bun disposition**: should-port (decide Bun's own default; document the dir-component asymmetry if libuv parity is kept). Target: process.path-search.

### [PROC-18] Honor NoDefaultCurrentDirectoryInExePath before searching cwd

- **What Windows does**: By default Windows searches the current directory BEFORE PATH (a known planting attack vector); the `NoDefaultCurrentDirectoryInExePath` env var (checked via `NeedCurrentDirectoryForExePathW`) opts a process out.
- **How libuv handles it**: bare names try cwd first ONLY if `NeedCurrentDirectoryForExePathW(L"")` says so (process.c:381-387); otherwise straight to PATH entries.
- **History**: 5e302730 (#4238, fixes #3888; refs nodejs/node#46264). Before this, libuv unconditionally searched cwd first.
- **Bun disposition**: must-port (security posture + node parity; cheap call). Target: process.path-search.

### [PROC-19] PATH entries may be quoted — with double OR single quotes — to protect embedded semicolons

- **What Windows does**: `PATH="C:\dir;with;semis";C:\other` is legal; cmd.exe honors the quotes.
- **How libuv handles it**: slice scanner first skips to the closing quote (either `"` or `'`, unterminated quote runs to end-of-string) before looking for the `;` separator (process.c:403-408); then strips one leading and one trailing quote char from the slice (process.c:423-431).
- **History**: 82cf0b38 (2011) stripped quotes; cbcf13af (2017, #1422 / nodejs/help#728) fixed a CRASH when a quoted entry contained semicolons — the separator scan ran inside the quotes. `spawn_quoted_path` test pins it with an invalid drive so nothing actually spawns (test-spawn.c:1965).
- **Bun disposition**: must-port (both quote chars; unterminated-quote fallback). Target: process.path-search.

### [PROC-20] Leading/empty PATH separators: skip empty slices, don't loop forever

- **What Windows does**: `PATH=;C:\foo` and doubled `;;` occur in the wild; an empty slice means "no directory" (cmd treats it as cwd — libuv deliberately does NOT).
- **How libuv handles it**: the iterator only advances past a separator when not at the very start unless the first char IS `;` (process.c:394-397); zero-length slices `continue` (process.c:415-417).
- **History**: 621c4a39 "Fix an infinite loop in uv_spawn" (#909) — a PATH starting with `;` never advanced. Regression test `spawn_with_an_odd_path` (test-spawn.c:1350) sets `PATH=;;;...`.
- **Bun disposition**: must-port (fuzz the PATH tokenizer: leading/trailing/doubled `;`, quote-only entries, empty PATH). Target: process.path-search.

### [PROC-21] Classify each PATH/dir entry into 4 path shapes before joining with cwd

- **What Windows does**: Windows path forms that a joiner must distinguish: UNC `\\server\share`, drive-absolute `D:\x`, drive-RELATIVE `D:x` (relative to D:'s per-drive cwd!), rooted-no-drive `\x` (current drive's root), and plain relative.
- **How libuv handles it**: `search_path_join_test` (process.c:151-240): UNC (`//` or `\\`, slashes interchangeable) → ignore cwd; rooted-no-drive → keep only cwd's 2-char drive prefix; drive-relative `D:x` → if same drive as cwd, substitute the full cwd, else use entry as-is (i.e. resolves against D:'s root in practice, not D:'s true per-drive cwd — libuv has no access to it); drive-absolute → ignore cwd; relative → append to cwd. Separator added only if the prefix doesn't already end in `\/:`.
- **History**: ac879ed8 added UNC support (deliberate DEVIATION from cmd.exe, which refuses UNC program paths — comment process.c:326-329 calls that "a pointless restriction"); 7024f8b2 (#3159) accepted `//server/share` forward-slash UNC.
- **Bun disposition**: must-port the classifier (this is the part a from-scratch impl always gets wrong; drive-relative entries in PATH are rare but real). Target: process.path-search.

### [PROC-22] Reject empty file and lone "."

- **What Windows does**: joining an empty program name against `C:\Windows` + `.exe` yields `C:\Windows\.exe` — a hidden-file lookup, potentially attacker-plantable.
- **How libuv handles it**: `file_len == 0 || (file_len == 1 && file[0] == '.')` → search fails immediately (process.c:347-353, the "GFY" comment).
- **History**: comment present since 2011.
- **Bun disposition**: must-port (also reject lone ".." for the same reason; libuv's `..` falls through to dir handling). Target: process.path-search.

### [PROC-23] Existence probe = GetFileAttributesW, exclude directories, ALLOW reparse points, no execute-bit check

- **What Windows does**: There is no X bit; CreateProcess decides executability. GetFileAttributesW on a symlink reports the link's attributes including FILE_ATTRIBUTE_REPARSE_POINT.
- **How libuv handles it**: candidate accepted iff attrs valid and NOT a directory (process.c:231-235). Reparse points pass (symlinked binaries). Search stops at the FIRST existing match — if CreateProcess then fails (e.g. not a PE), libuv does NOT resume searching, mirroring cmd.exe (comment process.c:321-324). Unreadable PATH dirs simply fail the probe and the scan continues.
- **History**: 495d1a09 (2013, #748) removed the REPARSE_POINT exclusion — before it, "it was impossible to spawn a symlinked binary".
- **Bun disposition**: must-port (first-match-wins + no-X-bit + reparse-OK semantics; do not "improve" by continuing search after CreateProcess failure). Target: process.path-search.

### [PROC-24] cwd ≥ MAX_PATH must be shortened — CreateProcess is never longPathAware

- **What Windows does**: even with the LongPathsEnabled registry switch and a longPathAware manifest, the lpCurrentDirectory argument of CreateProcessW is still capped at MAX_PATH; longer → ERROR_DIRECTORY.
- **How libuv handles it**: after resolving cwd (explicit or inherited), `cwd_len >= MAX_PATH` → in-place `GetShortPathNameW` (process.c:980-987). If 8.3 names are disabled on the volume this fails and the spawn errors out (no fallback). Inherited cwd uses the size-then-fetch GetCurrentDirectoryW pattern with `r >= cwd_len` recheck for races (process.c:957-978).
- **History**: 23632e91 (2025) — commit message documents the longPathAware exception explicitly.
- **Bun disposition**: must-port (and consider `\\?\` prefixing experiments are useless here — CreateProcess rejects `\\?\` cwd; short-name is the only workaround). Target: process.spawn.

### [PROC-25] lpReserved2 carries the CRT fd blob: count, crt_flags[], HANDLE[]

- **What Windows does**: Microsoft's CRT smuggles child fd state through the undocumented STARTUPINFO.lpReserved2/cbReserved2: `int count; uint8 crt_flags[count]; HANDLE handles[count]`. Every msvcrt/UCRT child reads it in `ioinit`/lowio init to reconstruct fds 0..count-1 (fd N open iff FOPEN set and handle != INVALID_HANDLE_VALUE). Non-CRT children ignore it.
- **How libuv handles it**: process-stdio.c:32-54 defines the exact layout macros; `uv__stdio_create` fills it; uv_spawn points `startup.lpReserved2/cbReserved2` at it (process.c:1031-1032). cbReserved2 is a WORD — size capped at 65535 bytes; libuv separately caps stdio_count at 255 (`ERROR_NOT_SUPPORTED` above, process-stdio.c:178-180) and pads to minimum 3.
- **History**: layout inherited from node's old forked code; 07c6ac2b moved it into process-stdio.c. The format matches CRT source (lowio) and is consumed by both legacy msvcrt.dll and modern UCRT — this is how fds > 2 reach `child_process` children with `stdio: [0,1,2,'pipe','pipe']`.
- **Bun disposition**: must-port byte-for-byte (count as int, flags as uint8, then PACKED handle array). Needed for node:child_process fd>2 passing and for CRT children to see pipe fds as pipes. Target: process.stdio.

### [PROC-26] CRT flag bytes: FOPEN|FPIPE|FDEV chosen by GetFileType

- **What Windows does**: the CRT blob's per-fd flag byte tells the child CRT how to treat the handle: 0x01 FOPEN, 0x08 FPIPE, 0x40 FDEV (plus FEOFLAG/FCRLF/FNOINHERIT/FAPPEND/FTEXT). Wrong flags change the child's stdio buffering/seek behavior.
- **How libuv handles it**: constants at process-stdio.c:57-65. Mapping in uv\_\_stdio_create: created pipes → FOPEN|FPIPE; NUL and TTY/char devices → FOPEN|FDEV; disk files → FOPEN; FILE_TYPE_REMOTE (unused-by-MS value 0x8000) → FOPEN|FDEV; FILE_TYPE_UNKNOWN with `GetLastError() == 0` (legitimately unknown, e.g. some device drivers) → FOPEN|FDEV, but UNKNOWN with a real error → fail the spawn (process-stdio.c:275-301).
- **History**: from node's original code (3d538af0 era); the UNKNOWN/GetLastError dance is the documented GetFileType error idiom.
- **Bun disposition**: must-port (including the GetLastError()==0 disambiguation — GetFileType has an in-band error code). Target: process.stdio.

### [PROC-27] The HANDLE array in the CRT blob is misaligned — access only via memcpy/memset

- **What Windows does**: the blob layout is `4 + count` bytes before the handle array, so HANDLEs sit at alignment 4+count — generally NOT 8-aligned on x64. Direct `*(HANDLE*)p =` is UB (and faults on ARM64 with alignment checking, trips UBSan).
- **How libuv handles it**: all reads/writes go through memcpy/memset: `uv__stdio_handle` (process-stdio.c:416-420), the 0xFF-fill for INVALID_HANDLE_VALUE (process-stdio.c:197 — memset 0xFF works because INVALID_HANDLE_VALUE is all-FF), and every `memcpy(CHILD_STDIO_HANDLE(...))` site.
- **History**: 9b3b61f6 "build: ubsan fixes (#4254)" — UBSan caught `store to misaligned address ... for type 'HANDLE'` at process-stdio.c:197.
- **Bun disposition**: must-port (in Rust: `ptr::write_unaligned`/`read_unaligned` or a #[repr(packed)] view; never a `&mut HANDLE` into the blob). Target: process.stdio.

### [PROC-28] First three handles ALSO go in STARTF_USESTDHANDLES — same handles, no extra dup

- **What Windows does**: non-CRT children (and GetStdHandle callers) read hStdInput/hStdOutput/hStdError, which only apply when STARTF_USESTDHANDLES is set; CRT children read the blob. Both views must agree.
- **How libuv handles it**: `startup.hStdInput/Output/Error = uv__stdio_handle(buffer, 0/1/2)` — the SAME inheritable duplicates referenced from both places (process.c:1029-1036); STARTF_USESTDHANDLES always set. No second duplication.
- **History**: stable since the early stdio rework (3ec9c67f, f5b51277).
- **Bun disposition**: must-port. Target: process.stdio.

### [PROC-29] FDs 0-2 are ALWAYS populated; ignored slots get an inheritable NUL handle with asymmetric access

- **What Windows does**: a child whose stdin/stdout/stderr handle is missing can crash or misbehave (CRT printf to an absent handle, GetStdHandle(NULL) propagation).
- **How libuv handles it**: count is padded to ≥3 (process-stdio.c:181-184). UV_IGNORE on fd ≤ 2 opens `NUL` via CreateFileW with SECURITY_ATTRIBUTES.bInheritHandle=TRUE (no dup needed), access = FILE_GENERIC_READ for fd0, FILE_GENERIC_WRITE|FILE_READ_ATTRIBUTES for fd1/2, share read+write, flagged FOPEN|FDEV (process-stdio.c:144-166, 210-229). UV_IGNORE on fd > 2 stays INVALID_HANDLE_VALUE (closed). The FILE_READ_ATTRIBUTES extra right exists so the child can probe its own stdout (GetFileType/NtQueryInformationFile — same rationale as the pipe-end rights fixed in 2e74e2ce for uv_shutdown on write-only pipes).
- **History**: bdb8b3a1 "always set FDs 0-2 for spawned child processes"; comment at process-stdio.c:210-216.
- **Bun disposition**: must-port (NUL-fill ignored stdio 0-2 with those exact access masks). Target: process.stdio.

### [PROC-30] Filter (HANDLE)-2 before DuplicateHandle — the CRT's "no handle" sentinel duplicates "successfully"

- **What Windows does**: `_get_osfhandle()` returns -2 (`_NO_CONSOLE_FILENO`) for fd 0-2 when the process has no console stdio. DuplicateHandle HAPPILY duplicates (HANDLE)-2 and returns success; the child then explodes when using it.
- **How libuv handles it**: `uv__duplicate_handle` rejects INVALID_HANDLE_VALUE, NULL, and literally `(HANDLE)-2` with ERROR_INVALID_HANDLE before calling DuplicateHandle (process-stdio.c:102-112).
- **History**: comment block dates to a1157cef/9d71d1ca era (joyent/node#3779 — GUI-subsystem node had no stdio).
- **Bun disposition**: must-port (any fd→handle path that can see CRT fds needs the -2 filter; also pseudo-handle values from GetCurrentProcess() are negative — never pass raw user fds straight to DuplicateHandle). Target: process.stdio.

### [PROC-31] \_get_osfhandle on a bad fd ASSERTS in debug CRTs — suppress around the call

- **What Windows does**: debug builds of the MS CRT pop an assertion dialog (or call the invalid-parameter handler) for invalid fds, even though release builds politely return INVALID_HANDLE_VALUE.
- **How libuv handles it**: `uv__get_osfhandle` wraps the call in UV_BEGIN/END_DISABLE_CRT_ASSERT (handle-inl.h:98-110), a thread-local flag consulted by libuv's installed CRT report hook (internal.h:43-58).
- **History**: c0716b3d "windows: improved handling of invalid FDs" — fixed node test-listen-fd-ebadf hangs/dialogs in debug builds.
- **Bun disposition**: should-port — only relevant where Bun converts CRT fds (embedder API/node-API interop). If Bun's spawn path never consults the CRT fd table, skip; if it accepts numeric fds from JS that index the CRT table (node compat does), the validation must not use raw `_get_osfhandle` in debug builds. Target: process.stdio / sys fd mapping.

### [PROC-32] Invalid fd 0-2 in UV_INHERIT_FD is forgiven; invalid fd > 2 is an error

- **What Windows does**: GUI-subsystem processes legitimately have no stdio at all; insisting on duplicating their fd 0-2 makes every spawn fail.
- **How libuv handles it**: UV_INHERIT_FD dup failure with ERROR_INVALID_HANDLE and fd ≤ 2 → leave the slot INVALID_HANDLE_VALUE/flags 0 and continue; any other fd or error → fail the spawn (process-stdio.c:262-272).
- **History**: 9d71d1ca "ignore errors when duplicating fd 0-2 fails. Hopefully this fixes joyent/node#3779."
- **Bun disposition**: must-port (node-compat: `stdio: 'inherit'` from a GUI parent must not fail). Target: process.stdio.

### [PROC-33] Inheritable dups + bInheritHandles=TRUE = process-wide leak window libuv never closed

- **What Windows does**: CreateProcessW with bInheritHandles=TRUE hands the child EVERY currently-inheritable handle in the process, not just the intended stdio. Two concurrent spawns (any threads/loops) therefore cross-leak each other's stdio dups; an inheritable handle created by any library leaks into all children. Leaked pipe write-ends are the classic "pipe never EOFs" bug.
- **How libuv handles it**: it doesn't fix it — it mitigates: (1) every OTHER handle libuv creates is born non-inheritable (fs handles 4197fc76, sockets WSA_FLAG_NO_HANDLE_INHERIT 5f3c0d3d/d19855c7, accepted sockets b1649b6f/64f5c93f); (2) stdio handles are duplicated to inheritable copies only transiently (process-stdio.c:116-122) and closed right after CreateProcess (PROC-35); (3) apps are told to call `uv_disable_stdio_inheritance` early (PROC-34). The proper fix — PROC_THREAD_ATTRIBUTE_HANDLE_LIST — was never adopted on v1.x: it requires STARTUPINFOEX (post-XP-only at the time), every listed handle must still be inheritable AND the CRT-blob handles must be in the list, and changing it risked the long-stable lpReserved2 interplay. The docs admit "There is no guarantee that this function does a perfect job" (process-stdio.c:68-73 comment; docs/src/process.rst:246-257).
- **History**: architecture-level; the mitigation commits above span 2012-2025 (d19855c7 is 2026 — they are STILL patching leak sources). The ConPTY side-branch (4dcfac47, not in v1.x) does use an attribute list — proof it composes with lpReserved2.
- **Bun disposition**: must-port the FIX libuv couldn't ship: use STARTUPINFOEXW + PROC_THREAD_ATTRIBUTE_HANDLE_LIST listing exactly the child's handles (they must also be marked inheritable), keep lpReserved2 alongside (attribute list and CRT blob compose), and keep creating all other handles non-inheritable. This removes the concurrent-spawn race entirely on Win10 1809+. Target: process.spawn + sys handle hygiene.

### [PROC-34] uv_disable_stdio_inheritance: best-effort de-inheriting of OUR inherited handles — including our own lpReserved2

- **What Windows does**: handles a parent leaked INTO us stay inheritable and would cascade into OUR children forever.
- **How libuv handles it**: clears HANDLE*FLAG_INHERIT on GetStdHandle(STD*\*) (ignoring NULL/INVALID), then parses our OWN startup info via GetStartupInfoW and, if `uv__stdio_verify` passes, un-inherits every handle in the inherited CRT blob (process-stdio.c:74-95). All error returns deliberately ignored — "stdio handles may not be valid, or may be closed already".
- **History**: ade69302 (2012), paired with the unix variant 4d7f1e18.
- **Bun disposition**: should-port (node calls it at startup; Bun should do the equivalent once at boot for parity — cheap insurance against leaky parents like older cmd/conhost). Target: process boot / runtime init.

### [PROC-35] Treat inbound lpReserved2 as hostile: verify before walking

- **What Windows does**: ANY parent can stuff arbitrary bytes into your STARTUPINFO.lpReserved2.
- **How libuv handles it**: `uv__stdio_verify` (process-stdio.c:387-408): non-NULL, size ≥ header, count ≤ 256, size ≥ CHILD_STDIO_SIZE(count) — only then does noinherit walk it. (Outbound creation caps at 255; inbound tolerates 256 — slack, not a bug.)
- **History**: ade69302.
- **Bun disposition**: must-port wherever Bun parses its own startup blob (node-compat `fd` stdio in workers/children, or fd inheritance bookkeeping). Target: process boot.

### [PROC-36] UV_INHERIT_STREAM: leech the OS handle out of live uv streams; only TTY and connected pipes qualify

- **What Windows does**: n/a — API semantics: passing a parent's existing stream as child stdio.
- **How libuv handles it**: UV_TTY → handle + FOPEN|FDEV; UV_NAMED_PIPE with UV_HANDLE_CONNECTION → handle + FOPEN|FPIPE; everything else (TCP! listening pipes! closed handles) → ERROR_NOT_SUPPORTED (process-stdio.c:307-342). The handle is then dup'd inheritable like any other. Note the asymmetry vs Unix, where UV_INHERIT_STREAM can pass sockets — Windows children can't generically inherit sockets (LSP-era WSADuplicateSocket needed), so libuv refuses.
- **History**: f5b51277 ("change spawn() api to allow using existing streams for stdio"), 3d538af0.
- **Bun disposition**: must-port the type gate (Bun.spawn stdio accepting a socket must error on Windows, not silently pass a broken handle). Cross-ref: TCP area (socket inheritance). Target: process.stdio.

### [PROC-37] Child pipe ends: overlapped is opt-in per fd; IPC forces non-blocking

- **What Windows does**: a pipe handle opened FILE_FLAG_OVERLAPPED requires the child to use OVERLAPPED I/O; most CRT children expect synchronous handles. But synchronous handles deadlock libuv-style multiplexed IPC.
- **How libuv handles it**: `uv__create_stdio_pipe_pair` (pipe.c:420-482): server (parent) end always non-blocking/overlapped; CHILD end overlapped only when UV_OVERLAPPED_PIPE flag set or the pipe is IPC. Readable child ends also get FILE_WRITE_ATTRIBUTES and servers get both directions' access so either side can probe buffer state for shutdown.
- **History**: 62a0f763 "win,process: allow child pipe handles to be opened in overlapped mode" (#1784) — added for programs that DO use overlapped stdio (e.g. other libuv processes). The IPC deadlock saga is 4e53af91 (#1099, electron#10107, parcel#637...). Cross-ref: PIPES area.
- **Bun disposition**: must-port the default-synchronous-child-end rule + opt-in overlapped (node exposes it as `overlapped` stdio type). Target: process.stdio, cross-ref pipes.

### [PROC-38] Close the child's stdio handles in the parent on EVERY exit path — including success

- **What Windows does**: the inheritable duplicates live in the parent's handle table; CreateProcess gives the child its own copies. Parent copies left open leak and hold pipes open (no EOF).
- **How libuv handles it**: single cleanup funnel: `uv__stdio_destroy` closes every non-INVALID handle in the blob and frees it, on failure AND success (process.c:1164-1168); buffer is pre-filled with INVALID_HANDLE_VALUE so partial-failure cleanup is uniform (process-stdio.c:192-198, error path 353-355).
- **History**: 75d9411e moved child_stdio_buffer from uv_process_t to a stack local (#3850) — it had been living on the handle object long past its need.
- **Bun disposition**: must-port (RAII guard over the blob; drop closes all). Target: process.stdio.

### [PROC-39] CREATE_NO_WINDOW only when NO stdio is UV_INHERIT_FD; SW_HIDE is a separate axis

- **What Windows does**: two different "hide" mechanisms: CREATE_NO_WINDOW prevents console-subsystem children from getting a console AT ALL (breaks children that inherit the parent console's handles), while STARTUPINFO.wShowWindow=SW_HIDE only hides GUI windows (honored by the first ShowWindow call).
- **How libuv handles it**: HIDE_CONSOLE (or legacy HIDE) sets CREATE_NO_WINDOW only if NOT ONE stdio slot is UV_INHERIT_FD (process.c:1040-1049) — inheriting an fd implies the child may need the parent console. HIDE_GUI (or HIDE) sets wShowWindow=SW_HIDE; STARTF_USESHOWWINDOW is always set with SW_SHOWDEFAULT otherwise (process.c:1029, 1050-1056).
- **History**: three-step evolution: b21c1f90 made HIDE set CREATE_NO_WINDOW (consoles popped up for console-subsystem children, nodejs#15380); 491848a0 limited it to non-inherited stdio (#1625 — CREATE_NO_WINDOW broke children that needed the console); 4c2dcca2 split HIDE into HIDE_CONSOLE/HIDE_GUI (#2073, node `windowsHide`).
- **Bun disposition**: must-port all three flags and the inherit-fd guard (node maps `windowsHide` here; getting the guard wrong re-introduces invisible-console or flashing-console bugs). Target: process.spawn.

### [PROC-40] DETACHED = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, deliberately NOT CREATE_BREAKAWAY_FROM_JOB

- **What Windows does**: DETACHED_PROCESS = no inherited console; CREATE_NEW_PROCESS_GROUP = child ignores the parent group's Ctrl-C. Neither escapes a job object. CREATE_BREAKAWAY_FROM_JOB would escape one, but FAILS the entire CreateProcess if the current job lacks JOB_OBJECT_LIMIT_BREAKAWAY_OK.
- **How libuv handles it**: process.c:1058-1071 with the rationale comment: libuv's own job has SILENT_BREAKAWAY_OK so detached children of libuv processes naturally stay out (PROC-42); under FOREIGN job control a "fully daemonized" child may be impossible, and that is accepted rather than risking spawn failure. Detached children are also never assigned to the global job (process.c:1090).
- **History**: first detached implementation e99fdf0d was REVERTED in ec0eff95 (2012, "Detaching doesn't work yet, the setsid() call fails" — reverted cross-platform because the unix half was broken); re-landed as 69a923bf with the flag-based design. The no-breakaway tradeoff comment arrived with 4f61ab20.
- **Bun disposition**: must-port flags + the no-breakaway decision (attempting BREAKAWAY_FROM_JOB "to be thorough" breaks spawning inside CI runners/Docker-on-Windows jobs that disallow breakaway). Target: process.spawn.

### [PROC-41] Detached spawns are CREATE_SUSPENDED then ResumeThread — and the stated reason doesn't match the code

- **What Windows does**: CREATE_SUSPENDED starts the initial thread frozen so the parent can do setup (job assignment) before the child runs; ResumeThread releases it.
- **How libuv handles it**: CREATE_SUSPENDED is added ONLY in the UV_PROCESS_DETACHED branch (process.c:1070); after the (skipped-for-detached) job-assignment block, ResumeThread runs; on ResumeThread failure the child is TerminateProcess'd and spawn fails (process.c:1110-1116).
- **History**: c03569f0 (#4152). The commit message says the suspend exists "so that we can make sure we added it to the job control object before it does anything itself (such as launch more jobs or exit)" — but detached children are never assigned to the job; the non-detached path (which IS assigned) is not suspended. Either the flag landed on the wrong branch or the justification is stale; upstream never revisited. Net effect today: the assign-before-run race still exists for NON-detached children (benign-ish: a child that exits first makes AssignProcessToJobObject fail ERROR_ACCESS_DENIED, which is swallowed — PROC-43 — so a fast-exiting child's own subtree escapes kill-on-close).
- **Bun disposition**: must-port the CORRECTED pattern: suspend NON-detached children, assign to job, then resume (closes the race the commit message describes); plain spawn for detached. Keep the terminate-on-ResumeThread-failure path. Target: process.spawn.

### [PROC-42] Global kill-on-close job object: 4 limit flags, created once, handle deliberately leaked

- **What Windows does**: a job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE kills all members when its LAST handle closes — including implicit close at process death. That converts "parent died" into "children die", which Windows otherwise does not do.
- **How libuv handles it**: lazily via uv_once (process.c:65-66, 1091): non-inheritable job (attr.bInheritHandle=FALSE so children can't hold it open), LimitFlags = BREAKAWAY_OK | SILENT_BREAKAWAY_OK | DIE_ON_UNHANDLED_EXCEPTION | KILL_ON_JOB_CLOSE (process.c:92-96). SILENT_BREAKAWAY_OK means only processes EXPLICITLY assigned are members — grandchildren stay free to use their own job control (pre-Win8 had no nested jobs) and detached children never join. DIE_ON_UNHANDLED_EXCEPTION suppresses WER "app crashed" modal dialogs for member children (a hung dialog = hung CI). The job handle is NEVER closed — closing it would kill every child; it must leak until process death.
- **History**: 415f4d3e (2013) "windows: kill child processes when the parent dies — makes Windows behave just like Unix"; comment block process.c:69-84.
- **Bun disposition**: must-port wholesale (Bun's process-reaper semantics on Windows depend on this exact construction; nested jobs exist on Win10 but SILENT_BREAKAWAY is still the right call so children keep job-control freedom). Target: process.spawn / runtime init.

### [PROC-43] Per-spawn AssignProcessToJobObject: swallow ERROR_ACCESS_DENIED, fatal on anything else

- **What Windows does**: assignment fails ACCESS_DENIED if the child is already in a job without nesting support (pre-Win8 semantics, still possible with explicit job configs), or if the child already exited (handle still valid, process gone).
- **How libuv handles it**: process.c:1093-1107 — ACCESS_DENIED is swallowed ("otherwise there would be no way for libuv applications run under job control to spawn processes at all"); any other failure is uv_fatal_error (abort).
- **History**: 415f4d3e originally aborted on ANY failure → broke everyone running under job control → 4f61ab20 added the ACCESS_DENIED swallow with the explanatory comment.
- **Bun disposition**: must-port the swallow; soften the abort to a debug-log (a failed kill-tree assignment is degraded service, not memory corruption — Bun policy says user-reachable conditions must not panic). Target: process.spawn.

### [PROC-44] Windows-Store kernel bug: assign SELF to the job at init or the handle gets poisoned

- **What Windows does**: kernel bug — if the FIRST AssignProcessToJobObject on a job handle targets a Windows-Store/UWP process (e.g. the python.exe App Execution Alias), every SUBSEQUENT assignment with that handle fails ERROR_INVALID_PARAMETER (87). Suspected cause: handle gets bound to the Store app's Terminal Services session.
- **How libuv handles it**: `uv__init_global_job_handle` immediately assigns the CURRENT process to the fresh job (process.c:109-121) so the first use is always same-session; failure tolerated only if ERROR_ACCESS_DENIED (we're already in a non-nestable job). They never remove themselves ("there doesn't seem to be a reason to") — meaning the libuv process ITSELF is a member of its own kill-on-close job.
- **History**: c03569f0 (#4152), fixes JuliaLang/julia#51461 (spawn Store-app python, then ANY later spawn aborted in uv_fatal_error). 2023 — this bug exists on supported Windows 10/11.
- **Bun disposition**: must-port (Bun on a dev machine WILL spawn `python`/`wt` App Execution Aliases; without self-assign the second spawn breaks kill-tree or aborts). Note the side effect: the runtime joins its own job — verify this doesn't fight any future Bun job usage. Target: process.spawn / runtime init.

### [PROC-45] Exit watch: RegisterWaitForSingleObject thread-pool wait, marshaled to the loop via IOCP post

- **What Windows does**: there is no SIGCHLD; you wait on the process handle. RegisterWaitForSingleObject parks it on a shared wait thread (WT_EXECUTEINWAITTHREAD runs the callback ON that wait thread — cheap, but the callback must never block; WT_EXECUTEONLYONCE = one-shot).
- **How libuv handles it**: process.c:1134-1140; the callback only sets `exit_cb_pending` and PostQueuedCompletionStatus's the exit_req to the loop's IOCP (exit_wait_callback process.c:803-815, POST_COMPLETION_FOR_REQ req-inl.h:76-82). RegisterWaitForSingleObject failure = uv_fatal_error. The thread handle (info.hThread) is closed immediately after (after ResumeThread if suspended); the process handle is kept.
- **History**: shape stable since 2011; aa69f34d removed the old async-error hacks around it.
- **Bun disposition**: must-port the pattern (or the modern equivalent: a dedicated wait via the loop's own thread-pool; either way exit notification must hop to the loop thread before touching loop state). Target: process.exit-watch / loop integration.

### [PROC-46] Closing a process handle races its exit callback: UnregisterWaitEx(INVALID_HANDLE_VALUE) blocks until quiescent

- **What Windows does**: after UnregisterWait returns, the wait callback may STILL be running concurrently on the wait thread; only UnregisterWaitEx with CompletionEvent=INVALID_HANDLE_VALUE synchronously drains ("blocks until either the wait was cancelled, or the callback has completed").
- **How libuv handles it**: `uv__process_close` (process.c:862-880) uses the blocking UnregisterWaitEx form, then: if `exit_cb_pending` (callback already fired and posted), endgame is deferred until `uv__process_proc_exit` drains the queued completion — which sees UV_HANDLE_CLOSING and goes straight to endgame WITHOUT calling exit_cb (process.c:826-831). The non-closing path uses plain UnregisterWait (process.c:834-837) because the callback provably already ran. Failure of UnregisterWaitEx is fatal ("we can't recover").
- **History**: aa69f34d ("also fixes a race condition that could occur when the user closes a process handle before the exit callback has been made").
- **Bun disposition**: must-port the state machine exactly (pending-flag + closing-check + blocking unregister). This is the #1 shutdown crash generator in from-scratch implementations. Target: process.exit-watch.

### [PROC-47] Exit code is a full 32-bit DWORD reported through int64 — never truncate, NTSTATUS values are real exit codes

- **What Windows does**: GetExitCodeProcess yields DWORD; crashed processes report NTSTATUS (0xC0000005 access violation, 0xC000013A ctrl-C), which are > INT32_MAX.
- **How libuv handles it**: `uv__process_proc_exit` (process.c:839-844) zero-extends status into int64_t exit_code. If GetExitCodeProcess fails ("should never happen") the negative translated errno is passed AS the exit code to exit_cb. STILL_ACTIVE(259) is unambiguous here because the wait already signaled.
- **History**: 66ae0ff5 widened exit_cb status to int64_t explicitly because "we no longer have to strip the high bit ... problematic because an unhandled SEH exception" produced garbage; d667653f fixed the follow-up bug where a random value was reported.
- **Bun disposition**: must-port (Bun.spawn exitCode must surface ≥2^31 values; node reports e.g. 3221225477). Target: process.exit-watch.

### [PROC-48] After exit: close the process handle EAGERLY and latch ESRCH state

- **What Windows does**: a process handle held open keeps the kernel process object (and its pid's uniqueness) alive indefinitely — the Windows analog of a zombie, except invisible.
- **How libuv handles it**: once the exit callback path runs, CloseHandle(process_handle), set handle to INVALID_HANDLE_VALUE, set UV_HANDLE_ESRCH flag (process.c:846-849). `uv_process_kill` checks the flag first and returns UV_ESRCH without touching the dead handle (process.c:1370-1375). `uv__process_endgame` closes the handle if close happened pre-exit (process.c:883-893).
- **History**: 58418d53 "(#3539) ... user might unknowingly close a uv_process_t before doing waitpid on the zombie, leaving it forever undead" — the ESRCH latch lets wrappers detect already-reaped children.
- **Bun disposition**: must-port (close eagerly; pid reuse means any later by-pid operation is on borrowed time — keep operations handle-based; latch a reaped flag for kill()). Target: process.exit-watch.

### [PROC-49] Closing the uv_process_t does NOT kill or detach-kill the child

- **What Windows does**: n/a — semantic choice. POSIX libuv also leaves the child running, but POSIX has init-reaping; on Windows the global job is what eventually reaps on parent death.
- **How libuv handles it**: close just cancels the wait and closes our handle (PROC-46/48); the child runs on, still a member of the kill-on-close job (dies when the PARENT exits, not when the handle closes).
- **History**: implicit since 415f4d3e; the docs for UV_PROCESS_DETACHED spell out the only sanctioned way to outlive the parent.
- **Bun disposition**: must-port semantics (unref/close ≠ kill; only detached children survive runtime exit). Target: process API semantics.

### [PROC-50] All spawn failures are SYNCHRONOUS returns — after a tortured history

- **What Windows does**: n/a — API design.
- **How libuv handles it**: any failure up to and including CreateProcessW/ResumeThread returns a translated error from uv_spawn; "Spawn succeeded. Beyond this point, failure is reported asynchronously" (process.c:1118) — and in practice nothing after that fails non-fatally. Cleanup is a single done/done_uv funnel freeing all six buffers + stdio blob (process.c:1152-1170). On early failure stdio pipes are still set up enough that user-visible streams don't assert (ed82eae1).
- **History**: three eras: spawn errors printed to the CHILD's stderr (!), then delivered via exit_cb with a fake exit code (aa69f34d), then made synchronous to match unix (ed82eae1 + f764bff6, #865/#978).
- **Bun disposition**: must-port (sync errors; node's child_process re-wraps them as the 'error' event — that translation belongs in Bun's node-compat layer, not the spawn primitive). Target: process.spawn.

### [PROC-51] uv_kill signal model: TERM/KILL/INT/QUIT all = TerminateProcess(handle, 1); everything else ENOSYS; range-check EINVAL

- **What Windows does**: no signals. TerminateProcess is the only universal kill; the exit code is caller-chosen.
- **How libuv handles it**: signum < 0 or ≥ NSIG → UV_EINVAL (process.c:1175-1177; SIGKILL locally #defined as 9 at process.c:39, SIGQUIT/SIGHUP/SIGWINCH/NSIG patched in include/uv/win.h:85-96). SIGTERM/SIGKILL/SIGINT/SIGQUIT → TerminateProcess with exit code 1 ("killed processes normally return 1", process.c:1300-1310). Other signals → UV_ENOSYS. No CTRL_C_EVENT/CTRL_BREAK_EVENT generation — GenerateConsoleCtrlEvent is deliberately NOT used (it can't target a single non-group process and misfires on shared consoles).
- **History**: ee8a681a added SIGINT=terminate; 890eedaf (#1642) added EINVAL range checking (was ENOSYS for everything).
- **Bun disposition**: must-port (node parity: process.kill(pid, 'SIGINT') on Windows hard-terminates; documenting-not-emulating console ctrl events is the accepted tradeoff). Target: process.kill.

### [PROC-52] TerminateProcess on an already-dead process → ERROR_ACCESS_DENIED; disambiguate to ESRCH with a two-step probe (race documented, not fixable)

- **What Windows does**: kernel quirk: TerminateProcess on an exited-but-handle-open process fails ACCESS_DENIED — same code as a real permissions failure. Worse, the process object can be reported "exited" by GetExitCodeProcess slightly BEFORE the handle is signaled for WaitForSingleObject (they are not atomically consistent).
- **How libuv handles it**: on ACCESS_DENIED: (1) GetExitCodeProcess != STILL_ACTIVE → UV_ESRCH ("can be set incorrectly by the process, though that is uncommon"); (2) else WaitForSingleObject(handle, 0) == WAIT_OBJECT_0 → UV_ESRCH; else the genuine UV_EACCES-ish translation (process.c:1313-1338). The comment admits the residual race: a process that exited WITH code 259 microseconds ago may still report EACCES "but we cannot fix the kernel synchronization issue ... with just the APIs available to us in user space".
- **History**: b7e150ee (2012) first ESRCH mapping via GetExitCodeProcess; 129362f3 (#4301) switched to WaitForSingleObject "per documentation"; ff958799 (#4341) recombined BOTH checks because Wait-only regressed (handle not yet signaled → WAIT_TIMEOUT → wrong EPERM). Title says it all: "almost fix race".
- **Bun disposition**: must-port the combined two-step probe verbatim, including the code comment about the unfixable race. Target: process.kill. ADDENDUM (probed at implementation, Win11 26200): the race also runs the OTHER direction — TerminateProcess can SUCCEED on a process whose GetExitCodeProcess already reports exit, for the window until the handle is signaled. Production code is unaffected (the probe only runs after ACCESS_DENIED), but tests asserting "kill an exited process → ESRCH" must wait for the SIGNALED state, not merely the exit-code report.

### [PROC-53] kill(pid, 0) liveness: GetExitCodeProcess + WaitForSingleObject(0), BOTH

- **What Windows does**: GetExitCodeProcess returns STILL_ACTIVE(259) for running processes AND for processes that exited with code 259; WaitForSingleObject is authoritative but slightly lagged (PROC-52).
- **How libuv handles it**: signal 0 path (process.c:1341-1361): GetExitCodeProcess failure → translated error; != STILL_ACTIVE → ESRCH; else Wait(0): OBJECT_0 → ESRCH, TIMEOUT → 0 (alive), FAILED → translated, other → UV_UNKNOWN.
- **History**: a3d495c0 (2011) original; 129362f3/ff958799 reshaped it together with PROC-52.
- **Bun disposition**: must-port (process.kill(pid, 0) is the standard node liveness idiom). Target: process.kill.

### [PROC-54] uv_kill(pid): OpenProcess needs TERMINATE|QUERY_INFORMATION|SYNCHRONIZE; INVALID_PARAMETER means ESRCH; pid 0 = self

- **What Windows does**: OpenProcess on a nonexistent pid fails ERROR_INVALID_PARAMETER (not NOT_FOUND); WaitForSingleObject requires the SYNCHRONIZE right (forgetting it makes the PROC-52/53 probes fail WAIT_FAILED/access-denied).
- **How libuv handles it**: process.c:1388-1413. SYNCHRONIZE was added only in 129362f3 when Wait entered the picture — a from-scratch port copying old access masks silently breaks the ESRCH probe. pid 0 maps to GetCurrentProcess() (Linux kill(0,..) = process group → approximated as self, 890eedaf). ERROR_INVALID_PARAMETER → UV_ESRCH.
- **History**: 2b7774ae (ESRCH mapping), 890eedaf (pid 0), 129362f3 (SYNCHRONIZE).
- **Bun disposition**: must-port (exact access mask + INVALID_PARAMETER→ESRCH). Target: process.kill.

### [PROC-55] exit_signal bookkeeping: kills via the HANDLE are reported as term_signal; kills by PID are not

- **What Windows does**: nothing — emulation: POSIX waitpid distinguishes exit-by-signal; Windows has only an exit code.
- **How libuv handles it**: `uv_process_kill` records `process->exit_signal = signum` AFTER a successful kill (process.c:1382); `uv__process_proc_exit` passes it as exit_cb's term_signal (process.c:856-858). So: killed via uv_process_kill → (exit_code=1, signal=SIGTERM-or-whatever); killed via uv_kill(pid) or externally → (exit_code=1, signal=0). Node builds `child.signalCode` from this — same kill, different observable result depending on which API was used.
- **History**: shape from ee8a681a era.
- **Bun disposition**: must-port the asymmetry knowingly (node-compat tests depend on subprocess.kill() yielding signalCode='SIGTERM' while taskkill from outside yields exitCode=1/signal null). Target: process.kill / exit-watch.

### [PROC-56] SIGQUIT writes a WER-style minidump of the TARGET before terminating — gated on the LocalDumps registry key

- **What Windows does**: Windows Error Reporting user-mode dumps are configured under `HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps` (optional `DumpFolder`, default `%LOCALAPPDATA%\CrashDumps`). Nothing dumps a process on demand unless someone calls MiniDumpWriteDump.
- **How libuv handles it**: uv\_\_kill SIGQUIT path (process.c:1186-1298): only if the LocalDumps key exists; read DumpFolder else default via SHGetKnownFolderPath(LOCALAPPDATA); CreateDirectoryW (WER itself creates the folder, so match); dump file `<exe-basename>.<pid>.dmp` with CREATE_NEW (never clobber); arm FILE_DISPOSITION_INFO delete-on-close FIRST, write MiniDumpWriteDump(FullMemory | IgnoreInaccessibleMemory | AvxXStateContext), then disarm delete-on-close ONLY on success — a failed/partial dump self-destructs. Then falls through to TerminateProcess.
- **History**: 748d894e (#3840, Julia's staticfloat) — explicitly mimics WER pathing so existing fleet config controls it.
- **Bun disposition**: should-port (free crash-dump-on-demand for `process.kill(pid,'SIGQUIT')`; node ships this via libuv today, so dropping it is a small node-compat regression; low risk because it's registry-gated). Target: process.kill.

### [PROC-57] Minidump details: Wine ELF flag, AVX constant missing on old SDKs, MinGW uuid.dll GUID, chars-vs-bytes CVE

- **What Windows does / build env does**: (a) Wine's dbghelp dumps ELF/Mach-O modules only if SYMOPT 0x40000000 is set; (b) `MiniDumpWithAvxXStateContext` is absent from Server2012r2-era SDKs and MinGW < 12 headers; (c) MinGW lacks uuid.dll's FOLDERID_LocalAppData symbol; (d) `_snwprintf_s` takes CHARACTERS, `RegGetValueW`/`GetModuleBaseNameW` size args differ (bytes vs chars).
- **How libuv handles it**: (a) `SymSetOptions(sym_options | 0x40000000)` around the dump, restored after (process.c:1266-1268, 1294 — "Tell wine to dump ELF modules as well"); (b) `#ifndef MiniDumpWithAvxXStateContext #define 0x00200000` (process.c:1270-1273, d1a2efc7); (c) a private `FOLDERID_LocalAppData_libuv` GUID literal (process.c:1217-1220, 34db4c21); (d) 2e86f6b6 fixed sizeof→ARRAY_SIZE for both \_snwprintf_s calls (GHSA-jjrx-vr7q-7732). Residual wart: `GetModuleBaseNameW(..., sizeof(basename))` at process.c:1192 still passes BYTES where the API wants CHARACTERS — latent over-claim, unexploitable because module base names fit MAX_PATH.
- **History**: as cited; the GHSA was judged non-security ("paths not under attacker control unless the system has been compromised beyond salvation").
- **Bun disposition**: should-port (a) if Bun adopts PROC-56 (Wine CI users benefit); skip (b)(c) — Rust + windows-sys on 1809+ has the constants and GUIDs; must-port (d) as a review rule: every W-API size arg gets a chars-or-bytes audit. Target: process.kill.

### [PROC-58] Spawn errno translation: the mappings node users actually see

- **What Windows does**: CreateProcessW and friends return Win32 codes with no POSIX shape: ERROR_FILE_NOT_FOUND (exe missing after search), ERROR_DIRECTORY (bad/too-long cwd), ERROR_ELEVATION_REQUIRED (exe manifest demands UAC), ERROR_BAD_EXE_FORMAT (not a PE / wrong arch), ERROR_ACCESS_DENIED (ACL).
- **How libuv handles it**: uv_spawn funnels GetLastError through uv_translate_sys_error (process.c:1153-1154; table src/win/error.c:67-180): FILE_NOT_FOUND/PATH_NOT_FOUND/DIRECTORY/INVALID_NAME/INVALID_DRIVE/BAD_PATHNAME → UV_ENOENT (bad cwd = ENOENT, matching POSIX chdir); ELEVATION_REQUIRED → UV_EACCES (11ce5df5, nodejs/node#9464 — double-click-to-elevate exes spawned from node); BAD_EXE_FORMAT → UV_EFTYPE (36f0789d, #2348); ACCESS_DENIED → UV_EPERM (NOT EACCES — divergence from POSIX exec semantics that node has absorbed); search_path miss is reported as ERROR_FILE_NOT_FOUND before CreateProcess even runs (process.c:1019-1022).
- **History**: b65b7474 started translating spawn errors at all; individual mappings as cited.
- **Bun disposition**: must-port this exact mapping (Bun's JS layer compares err.code strings; EPERM-vs-EACCES and EFTYPE are pinned by node tests). Cross-ref: ERRORS area. Target: process.spawn / error mapping.

### [PROC-59] Validate flags/options up front: SETUID/SETGID → ENOTSUP, NULL file/args → EINVAL, fd cap → ENOTSUP

- **What Windows does**: n/a.
- **How libuv handles it**: process.c:914-931 (flags assert lists the full accepted set), stdio count cap 255 in uv\_\_stdio_create. The "options.file may not be NULL" check exists because CreateProcess would otherwise parse lpCommandLine itself — explicitly forbidden territory (ee115bfd).
- **History**: d41cc911/99a995a6 (setuid/gid reporting), ee115bfd.
- **Bun disposition**: must-port equivalents (uid/gid options on Windows must hard-error, not silently ignore). Target: process.spawn.

### [PROC-60] No alloca/\_alloca anywhere in spawn paths — env blocks blew the stack

- **What Windows does**: alloca of user-controlled size (#args, env size, PATH length) on a 1MB default stack = stack overflow = unrecoverable on Windows.
- **How libuv handles it**: heap allocations throughout (`make_program_args` temp buffer process.c:559; env copies process.c:674); 3e5d2614 replaced alloca for required_vars_value_len with a fixed array; e0c5fc87 (#4361, fixes #4348) removed the last \_alloca "since it can cause stack overflows".
- **History**: as cited — this regressed twice before being eradicated.
- **Bun disposition**: skip (Rust has no alloca temptation) — recorded so nobody adds a stack-buffer "optimization" for command lines. Target: n/a.

### [PROC-61] IPC pipes get the child pid stamped after CreateProcess succeeds

- **What Windows does**: a named-pipe server can query GetNamedPipeClientProcessId, but for freshly-spawned IPC children the pid is already known and the query is racy-at-best before the client connects.
- **How libuv handles it**: post-spawn loop stamps `info.dwProcessId` into every UV_CREATE_PIPE+ipc stdio container's `pipe.conn.ipc_remote_pid` (process.c:1123-1132); pipe.c later prefers that over GetNamedPipeClientProcessId (pipe.c:1747-1798, 2515-2519 falls back to server pid when the queried pid is self).
- **History**: 67090653 "set the child_pid property for all IPC pipes"; the pid is used to translate WSAPROTOCOL_INFO socket-sharing structures to the right target process.
- **Bun disposition**: should-port when Bun implements node-IPC socket handoff on Windows (the pid is load-bearing for WSADuplicateSocketW). Cross-ref: PIPES area. Target: process.stdio / ipc.

### [PROC-62] Exit-wait callback asserts are loud on purpose; RegisterWait failure is fatal

- **What Windows does**: RegisterWaitForSingleObject can fail under handle pressure; the callback contractually fires exactly once with didTimeout=FALSE for INFINITE waits.
- **How libuv handles it**: `assert(didTimeout == FALSE)`, `assert(!process->exit_cb_pending)` (process.c:803-811); RegisterWait failure → uv_fatal_error (process.c:1138-1140) because at that point the child is RUNNING and unobservable — limping on would orphan the handle silently.
- **History**: stable since aa69f34d.
- **Bun disposition**: must-port the spirit: if exit-watch registration fails after a successful CreateProcess, Bun must either kill the child and fail the spawn, or guarantee an alternate reap path — never return success without a working exit notification. Target: process.exit-watch.

### [PROC-63] GetShortPathNameW / GetCurrentDirectoryW / GetEnvironmentVariableW all use the size-probe-then-fill idiom with re-check

- **What Windows does**: every "returns required length" API can race with concurrent mutation; the second call can return MORE than the probe.
- **How libuv handles it**: `r == 0 || r >= cwd_len` → error (process.c:973-977); PATH fetch same pattern (process.c:1003-1007); env fetch aborts on mismatch (PROC-13).
- **History**: pattern hardened across b83caf86 and later cleanups.
- **Bun disposition**: must-port as a sys-layer convention (loop-until-stable or accept-failure; never trust probe==fill). Cross-ref: ENV/FS areas. Target: sys string fetch helpers.

### [PROC-64] uv_spawn always initializes the handle — even on early failure

- **What Windows does**: n/a — API contract subtlety.
- **How libuv handles it**: `uv__process_init` runs FIRST (process.c:910), before any validation, so a failed uv_spawn still leaves a closeable uv_process_t (wait_handle/process_handle = INVALID_HANDLE_VALUE sentinels, exit req pre-wired, process.c:130-141).
- **History**: 6f62d62c "windows: always initialize uv_process_t" — callers uv_close'd failed spawns and crashed.
- **Bun disposition**: must-port semantics (Bun's Subprocess object must be droppable/closeable after a failed spawn without UB). Target: process API.

---

## Tally

- Total quirks: 64
- must-port: 57 (PROC-01..16, 18..30, 32, 33, 35..55, 58, 59, 62, 63, 64)
- should-port: 6 (PROC-17 exact-name flag, PROC-31 CRT assert suppression, PROC-34 disable_stdio_inheritance, PROC-56 SIGQUIT minidump, PROC-57 minidump build-env details — its old-SDK/MinGW sub-items (b)(c) are explicitly skipped inline, PROC-61 IPC pid stamping)
- skip: 1 (PROC-60 alloca eradication — no Rust equivalent hazard; recorded so nobody reintroduces stack buffers for command lines)
