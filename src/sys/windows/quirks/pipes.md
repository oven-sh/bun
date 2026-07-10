# libuv Windows institutional knowledge — PIPES (src/win/pipe.c, stream.c, handle.c, handle-inl.h, stream-inl.h, req-inl.h)

Source worktree: C:/Users/dylan/code/libuv-read (v1.x @ 439a54be). Also examined: origin/master (libuv v2 dev) and origin/bun + origin/dylan/win-appcontainer (oven-sh fork).

## Naming, creation, pairing

### [PIPE-01] Retry anonymous-pipe name creation on BOTH ERROR_PIPE_BUSY and ERROR_ACCESS_DENIED

- **What Windows does**: `CreateNamedPipe` with `FILE_FLAG_FIRST_PIPE_INSTANCE` fails with ERROR_ACCESS_DENIED when the name already exists and is owned by another user / created with incompatible settings, and with ERROR_PIPE_BUSY when it exists with all instances busy. Both mean "name collision", not "denied".
- **How libuv handles it**: `uv__pipe_server` (src/win/pipe.c:209-246) loops: generate name, `CreateNamedPipeA(access | FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT, 1 instance, 65536/65536, timeout 0)`; on PIPE_BUSY or ACCESS_DENIED increment the numeric seed and retry; any other error aborts.
- **History**: ee5236cf (2011) introduced FIRST_PIPE_INSTANCE so bind fails on in-use names; the retry-both-codes loop has been the shape ever since.
- **Bun disposition**: must-port. A from-scratch impl that treats ACCESS_DENIED as fatal will randomly fail spawns when a stale name from another user exists. Target: engine

### [PIPE-02] AppContainer: generated pipe names must live under \\?\pipe\LOCAL\ and ACCESS_DENIED retries must be capped

- **What Windows does**: An AppContainer (lowbox token) process may only create named pipes under `\\?\pipe\LOCAL\`. Everywhere else CreateNamedPipe fails ERROR_ACCESS_DENIED — the same code the collision retry treats as "try a new name", producing an infinite 100% CPU spin. Outside an AppContainer the `LOCAL\` prefix has no special meaning (it is just part of the name).
- **How libuv handles it**: Upstream does NOT handle it. The oven-sh fork does: f83e1d47 prefixes generated names with `LOCAL\` (`\\?\pipe\LOCAL\uv\<ptr>-<pid>`) and caps ACCESS_DENIED retries at one; 7783d113 (review/win-appcontainer, 2026-06-29) additionally resets the cap whenever an attempt fails with ERROR_PIPE_BUSY (PIPE_BUSY proves the namespace is accessible, so a later ACCESS_DENIED is a genuine collision again — needed because stdio names start from a constant seed and routinely walk several collisions), and translates the error at the API boundary (`uv_translate_sys_error`) plus fixes an `errno == UV_EMFILE` (should be `EMFILE`) comparison that made `uv_pipe()` return UV_UNKNOWN instead of UV_EMFILE.
- **History**: oven-sh fork commits f83e1d47 + 7783d113; not upstream as of v1.x 2026-06.
- **Bun disposition**: must-port (Bun explicitly targets sandboxed/AppContainer environments; this is Dylan's own fix). Target: engine

### [PIPE-03] The "randomness" seeding pipe names is weak by design; the retry loop is the real uniqueness mechanism

- **What Windows does**: Nothing — this is libuv's own scheme. Names are `\\?\pipe\uv\<u64>-<pid>`.
- **How libuv handles it**: `uv__unique_pipe_name` (pipe.c:109-111) takes a u64 "random" that is just a stack/handle pointer: `uv_pipe()` passes `(uintptr_t)&fds[0]` (pipe.c:357-365, comment "TODO: better source of local randomness than &fds?"); `uv__create_stdio_pipe_pair` passes `(uintptr_t)server_pipe` which at that point is INVALID_HANDLE_VALUE, i.e. a CONSTANT -1 seed for every stdio pipe (pipe.c:433,455). PID disambiguates across processes; the PIPE-01 retry loop disambiguates within a process (and across users for leftover names).
- **History**: code comment only; 9b3b61f6 (ubsan) changed the param from `char*` to `unsigned long long`.
- **Bun disposition**: must-port the _insight_: don't rely on the seed for correctness — collisions WILL happen (constant seed!), so the retry loop is load-bearing. Bun should use a real RNG plus the retry loop. Target: engine

### [PIPE-04] CreateNamedPipe parameters: byte mode, 64 KiB buffers, 1 instance for pairs / unlimited for servers

- **What Windows does**: Pipe type/readmode (byte vs message), buffer quotas and instance counts are fixed at creation. OutboundQuota chosen here is what the shutdown probe (PIPE-50) compares against.
- **How libuv handles it**: pairs: `PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT`, 1 instance, 65536/65536, default timeout (pipe.c:218-221). Server accept instances: `PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|WRITE_DAC` + `PIPE_UNLIMITED_INSTANCES`, 65536/65536 (pipe.c:566-571); only the first instance passes FILE_FLAG_FIRST_PIPE_INSTANCE.
- **History**: stable since 2011 split (3a91232f).
- **Bun disposition**: must-port (byte mode is assumed by the entire read model; 64 KiB matches the read chunk size). Target: engine

### [PIPE-05] uv_pipe()/pair creation: server side = read end so BOTH ends get FILE_READ_ATTRIBUTES

- **What Windows does**: A `PIPE_ACCESS_INBOUND` server handle has GENERIC_READ (includes FILE_READ_ATTRIBUTES); the client opened GENERIC_WRITE gets FILE_READ_ATTRIBUTES only if explicitly requested. FILE_READ_ATTRIBUTES is what NtQueryInformationFile(FilePipeLocalInformation) needs.
- **How libuv handles it**: `uv_pipe()` makes the read end the server (pipe.c:355-359 comment). `uv__create_pipe_pair` builds client access as `GENERIC_READ|FILE_WRITE_ATTRIBUTES` or `FILE_READ_ATTRIBUTES` when not readable, `GENERIC_WRITE` or `FILE_WRITE_ATTRIBUTES` when not writable, always `WRITE_DAC` (pipe.c:274-283); server access maps UV_READABLE/WRITABLE→PIPE_ACCESS_INBOUND/OUTBOUND + WRITE_DAC + FILE_FLAG_OVERLAPPED iff UV_NONBLOCK_PIPE (pipe.c:265-272).
- **History**: 4ddc2927 (2020) added uv_pipe()/uv_socketpair; access-bit dance descends from 61b20e8d (2013).
- **Bun disposition**: must-port (the cross-granted attribute rights are required by SetNamedPipeHandleState on the reader and the shutdown probe on the writer; WRITE_DAC required for chmod). Target: engine

### [PIPE-06] Stdio pipe server end takes BOTH directions when the child reads, purely to enable the shutdown probe

- **What Windows does**: CreateNamedPipe grants FILE_READ_ATTRIBUTES on the server handle only if the server has inbound access.
- **How libuv handles it**: `uv__create_stdio_pipe_pair` (pipe.c:436-452): if child-readable (parent writes), server*flags = READABLE|WRITABLE (comment at 438-444: "The server needs inbound (read) access too, otherwise CreateNamedPipe() won't give us the FILE_READ_ATTRIBUTES permission. We need that to probe the state of the write buffer when we're trying to shutdown the pipe."); the \_uv-visible* flags are then set to only WRITABLE (468). Server end is always overlapped; client end overlapped only if UV_NONBLOCK_PIPE requested or the pipe is IPC (449-452). Client handle inheritability set via SECURITY_ATTRIBUTES.bInheritHandle (pipe.c:295-297).
- **History**: 61b20e8d (2013) "make uv_shutdown() for write-only pipes work" — before it, shutdown of stdout pipes failed ERROR_ACCESS_DENIED.
- **Bun disposition**: must-port if Bun keeps a flush-on-end semantic for child stdio (see PIPE-50/52); otherwise record as skip alongside dropping the probe. Target: engine

### [PIPE-07] Pair creation validates client mode in debug, and ConnectNamedPipe on a pre-connected pair must tolerate ERROR_PIPE_CONNECTED

- **What Windows does**: A client can connect between CreateNamedPipe and ConnectNamedPipe; ConnectNamedPipe then fails with ERROR_PIPE_CONNECTED, which means success. Blocking ConnectNamedPipe on a pair we hold both ends of cannot block.
- **How libuv handles it**: pipe.c:311-332: NDEBUG-only `GetNamedPipeHandleState` assert (mode == PIPE_READMODE_BYTE|PIPE_WAIT) — guards against environment-injected mode weirdness; blocking `ConnectNamedPipe(server, NULL)` accepting ERROR_PIPE_CONNECTED. Same tolerance in the async accept path (pipe.c:1150).
- **History**: code comment only.
- **Bun disposition**: must-port the ERROR_PIPE_CONNECTED-is-success rule (both places); the debug assert is optional. Target: engine

### [PIPE-08] uv_pipe(): \_open_osfhandle EMFILE handling and handle/fd ownership choreography

- **What Windows does**: `_open_osfhandle` consumes the HANDLE into a CRT fd; closing the fd closes the handle; the CRT has a finite fd table (errno EMFILE).
- **How libuv handles it**: pipe.c:368-389: on first fd failure CloseHandle both raw handles; on second failure `_close(temp[0])` (which closes readh) + CloseHandle(writeh). errno EMFILE → UV_EMFILE else UV_UNKNOWN. NOTE upstream v1.x bug: compares `errno == UV_EMFILE` (negative libuv code) instead of `EMFILE`, so EMFILE is always reported as UV_UNKNOWN; fixed on the oven-sh appcontainer branch (7783d113). Also returns the raw positive Win32 error from pair creation instead of a UV_E\* code — same commit fixes that.
- **History**: 7783d113 (fork).
- **Bun disposition**: must-port (correct error mapping + the no-double-close ownership steps). Target: engine

## Opening / attaching existing handles

### [PIPE-09] Connect: degrade GENERIC_READ|GENERIC_WRITE → read-only → write-only on ERROR_ACCESS_DENIED

- **What Windows does**: CreateFileW on a half-duplex pipe (PIPE_ACCESS_INBOUND or OUTBOUND only) fails with ERROR_ACCESS_DENIED when asked for the missing direction.
- **How libuv handles it**: `open_named_pipe` (pipe.c:139-194): try duplex; on ACCESS_DENIED retry `GENERIC_READ|FILE_WRITE_ATTRIBUTES` (read-only, returns UV_HANDLE_READABLE); on ACCESS_DENIED again retry `GENERIC_WRITE|FILE_READ_ATTRIBUTES` (write-only). The cross attribute rights are deliberate: FILE_WRITE_ATTRIBUTES lets the reader SetNamedPipeHandleState; FILE_READ_ATTRIBUTES lets the writer run the shutdown probe.
- **History**: f9be43a5 (2012) "support half-duplex pipes".
- **Bun disposition**: must-port (connecting to half-duplex servers — e.g. another process's stdout server — is common). Target: engine

### [PIPE-10] Tolerate SetNamedPipeHandleState ACCESS_DENIED if the pipe is already in a usable mode (Chrome native messaging, Cygwin/Mintty)

- **What Windows does**: SetNamedPipeHandleState requires GENERIC_WRITE or FILE_WRITE_ATTRIBUTES. Chrome launches native-messaging hosts with a strictly read-only stdin pipe handle; Cygwin/Mintty open stdin without FILE_WRITE_ATTRIBUTES and in MESSAGE readmode.
- **How libuv handles it**: `uv__set_pipe_handle` (pipe.c:504-527): try to force `PIPE_READMODE_BYTE|PIPE_WAIT`; on ERROR_ACCESS_DENIED, GetNamedPipeHandleState and continue as long as the current mode does NOT include PIPE_NOWAIT — i.e. message-readmode pipes are accepted as-is.
- **History**: ba47e688 (2014, joyent/node#7345 — originally required exact mode equality and stripped WRITABLE) then ebafb90a (2014) loosened to only reject PIPE_NOWAIT and moved readable/writable detection to access flags (PIPE-15).
- **Bun disposition**: must-port (read-only stdin under Chrome native messaging and Cygwin/MSYS terminals are real Bun targets). Target: engine

### [PIPE-11] Reject PIPE_NOWAIT pipes outright (UV_EACCES)

- **What Windows does**: PIPE_NOWAIT makes ReadFile/WriteFile return immediately with ERROR_NO_DATA, indistinguishable from "pipe closing" in places, and breaks blocking zero-reads. Microsoft documents PIPE_NOWAIT as a LAN Manager 2.0 compat relic and says not to use it.
- **How libuv handles it**: pipe.c:516-517 returns UV_EACCES if current mode has PIPE_NOWAIT. Historic context: pre-2011 libuv itself used PIPE_NOWAIT-style non-blocking reads to peek and replaced that with PeekNamedPipe (27655094, 2011) because of exactly these ambiguities.
- **History**: ebafb90a added the explicit check; 27655094 is the design lesson.
- **Bun disposition**: must-port (fail fast with a clear error; never try to support NOWAIT pipes in the readiness model). Target: engine

### [PIPE-12] SetNamedPipeHandleState ERROR_INVALID_PARAMETER means "not actually a pipe" → UV_ENOTSOCK

- **What Windows does**: Calling pipe APIs on a non-pipe (e.g. a disk file opened via uv_pipe_connect to a filesystem path) fails ERROR_INVALID_PARAMETER.
- **How libuv handles it**: pipe.c:520-524 maps it to UV_ENOTSOCK so `uv_pipe_connect("some/file")` reports ENOTSOCK, matching Unix connecting to a non-socket file.
- **History**: 019118c3 / e53ab667 (2012) "report UV_ENOTSOCK when we opened a file instead of a pipe" (pipe_connect_to_file test).
- **Bun disposition**: must-port (node compat: net.connect to a path that is a regular file must yield ENOTSOCK not weird EINVAL). Target: engine

### [PIPE-13] Detect non-overlapped handles via NtQueryInformationFile(FileModeInformation); overlapped-ness is immutable after creation

- **What Windows does**: Whether a handle does synchronous or overlapped I/O is fixed at CreateFile time (FILE_SYNCHRONOUS_IO_ALERT/NONALERT in the file object). The NT kernel cannot enable OVERLAPPED later (and cannot disable it either). There is no documented Win32 query; you must use NtQueryInformationFile.
- **How libuv handles it**: pipe.c:529-550: query FileModeInformation; if synchronous flags set → UV_HANDLE_NON_OVERLAPPED_PIPE + init readfile thread lock; else attach to IOCP. This is why the entire dual read/write machinery (worker threads vs IOCP) exists.
- **History**: 54982a23 (2011) "stdio over non-overlapped pipes" — children spawned by cmd.exe/other runtimes get non-overlapped stdio pipes; c869cd1d (2024) message restates the kernel limitation.
- **Bun disposition**: must-port (any fd Bun adopts from a non-libuv parent can be non-overlapped; must branch the whole I/O strategy on this probe). Target: engine

### [PIPE-14] IOCP attach can fail because the handle is ALREADY attached to another completion port → EMULATE_IOCP fallback, never fatal for adopted handles

- **What Windows does**: A handle can be associated with only one IOCP, ever; CreateIoCompletionPort on a handle that a parent/another loop already associated fails (ERROR_INVALID_PARAMETER). The association is inherited with duplicated handles.
- **How libuv handles it**: `uv__pipe_attach_iocp` (pipe.c:394-417): on CreateIoCompletionPort failure set UV_HANDLE_EMULATE_IOCP and carry on (comment at 546-549). For handles libuv itself just created (stdio pair server, accept instances) failure is `uv_fatal_error` instead (pipe.c:459-461, 578-580) since it cannot legitimately happen.
- **History**: 54982a23 introduced EMULATE_IOCP; 046aebe7 (2026) factored attach into one helper.
- **Bun disposition**: must-port the detection; the fallback itself is PIPE-16's question. Target: engine

### [PIPE-15] uv_pipe_open derives readable/writable from FileAccessInformation, not from trial I/O; IPC fds must be duplex

- **What Windows does**: NtQueryInformationFile(FileAccessInformation) returns the access mask the handle was opened with (FILE_READ_DATA/FILE_WRITE_DATA), even for handles received from foreign runtimes (Cygwin message-mode pipes etc.).
- **How libuv handles it**: pipe.c:2478-2500: query access flags; UV_EINVAL if the query fails; for ipc handles require both FILE_READ_DATA and FILE_WRITE_DATA; set UV_HANDLE_READABLE/WRITABLE from the mask. Comment notes Cygwin opens pipes in message mode and that is supported via this path.
- **History**: ebafb90a (2014).
- **Bun disposition**: must-port (this is how `uv_pipe_open(0/1/2)` of arbitrary inherited stdio decides direction; trial reads would consume data). Target: engine

### [PIPE-16] EMULATE_IOCP shim: event-handle-with-low-bit + RegisterWaitForSingleObject + manual PostQueuedCompletionStatus

- **What Windows does**: If OVERLAPPED.hEvent has its low-order bit set, the I/O manager does NOT queue a completion packet to the associated IOCP (documented in GetQueuedCompletionStatus remarks); the event is still signaled. RegisterWaitForSingleObject gives a thread-pool callback when the event fires.
- **How libuv handles it**: When EMULATE_IOCP: every read/write OVERLAPPED gets `hEvent = event_handle | 1` (pipe.c:1420-1423, 1620-1626) so the FOREIGN completion port (that some other owner attached) never sees our I/O; `RegisterWaitForSingleObject(..., WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE)` (pipe.c:1436-1443, 1730-1735) fires `post_completion_read_wait`/`post_completion_write_wait` (pipe.c:1362-1397) which PostQueuedCompletionStatus to OUR loop's IOCP with `overlapped.InternalHigh` as byte count; `UnregisterWait` on completion processing (pipe.c:2149-2152, 2208-2211). Read event handle is allocated once per stream and reused; write events are per-request.
- **History**: 54982a23 origin; 727ee723 (2024) added WT_EXECUTEONLYONCE and moved UnregisterWait to the processing site, asserting wait_handle is INVALID before each register (re-registration bug class).
- **Bun disposition**: should-port. Needed only when adopting a handle already bound to a foreign IOCP (e.g. fd inherited from a parent whose runtime attached it, then passed to uv_pipe_open). Rare but real for embedders; Bun can alternatively fail loudly with a clear error and add the shim on demand — record the decision. Target: engine

### [PIPE-17] The hEvent|1 trick is ALSO used on libuv's own IOCP to suppress packets for inline synchronous reads

- **What Windows does**: Same low-bit rule as PIPE-16 — works per-operation, on any handle, including ones attached to your own IOCP.
- **How libuv handles it**: After the zero-read signals readiness, the actual data reads (`uv__pipe_read_data` pipe.c:2018-2020, `uv__pipe_read_exactly` pipe.c:1947-1948) are issued as overlapped ReadFile with `hEvent = event_handle | 1` and consumed inline via GetOverlappedResult — the low bit prevents a spurious IOCP packet for an operation whose result is consumed synchronously. Without it the loop would later dequeue a packet pointing at a recycled OVERLAPPED.
- **History**: 727ee723 (2024) — the event became unconditional (created in `uv__pipe_read_start` pipe.c:1471-1476 for every pipe, not just EMULATE_IOCP).
- **Bun disposition**: must-port (any "issue overlapped op, wait inline" pattern on an IOCP-attached handle needs this or it corrupts the completion queue). Target: engine

### [PIPE-18] SetFileCompletionNotificationModes: FILE_SKIP_SET_EVENT_ON_HANDLE always; FILE_SKIP_COMPLETION_PORT_ON_SUCCESS only when IOCP attach succeeded; sync completions then bypass the IOCP

- **What Windows does**: SKIP_COMPLETION_PORT_ON_SUCCESS suppresses the packet when the call returns success immediately (data already buffered), so the result must be consumed at the call site. SKIP_SET_EVENT_ON_HANDLE avoids signaling the file object itself (minor perf, avoids waking waiters on the handle).
- **How libuv handles it**: `uv__pipe_attach_iocp` (pipe.c:405-415): always request SKIP_SET_EVENT_ON_HANDLE; add SKIP_COMPLETION_PORT_ON_SUCCESS only if CreateIoCompletionPort succeeded; if SFCNM succeeds with that flag set UV_HANDLE_SYNC_BYPASS_IOCP. Then `UV_SUCCEEDED_WITHOUT_IOCP(result)` (req-inl.h:69-70 — note: macro implicitly references local `handle`!) routes synchronous successes to `uv__insert_pending_req` (loop-local pending queue) instead of waiting for a packet that will never come: zero-read (pipe.c:1432-1434), plain writes (pipe.c:1726-1728), ConnectNamedPipe accept (pipe.c:1145-1148). Accepted client connections inherit the server instance's modes, so `uv__pipe_accept` sets UV_HANDLE_SYNC_BYPASS_IOCP on the client directly (pipe.c:1206).
- **History**: 046aebe7 (2026-03) copied the tcp/udp optimization to pipes. For sockets this API historically broke under non-IFS LSPs (see TCP area); pipes have no LSP problem.
- **Bun disposition**: must-port if Bun enables SKIP_COMPLETION_PORT_ON_SUCCESS on pipes (the failure mode of getting it wrong is a hang or double-completion); otherwise should-port as a perf follow-up. Note 1809+ baseline has no OS obstacle. Target: engine

### [PIPE-19] uv_pipe_open duplicates fds 0-2 and never closes them; CRT-owned fds are closed with \_close(), raw handles with CloseHandle()

- **What Windows does**: Closing a stdio fd's underlying handle kills console/stdio for the whole process; `_close()` closes both the CRT fd and the OS handle; CloseHandle on a CRT-owned handle leaks the fd slot and risks double-close.
- **How libuv handles it**: uv_pipe_open (pipe.c:2459-2476): for file <= 2, DuplicateHandle and forget the original fd (file = -1). Comment: using the original handle without closing would leave "no reliable way to cancel pending read operations upon close". `close_pipe` (pipe.c:197-206): `_close(fd)` when u.fd != -1 else CloseHandle; asserts `fd == -1 || fd > 2`.
- **History**: 90fb8cb0 + 4ed29c24 (2015, PR #396).
- **Bun disposition**: must-port (exact ownership matrix; the "duplicate so close can cancel" rationale matters for Bun.stdin teardown). Target: engine

### [PIPE-20] IPC remote PID: GetNamedPipeClientProcessId, falling back to ServerProcessId when it equals self

- **What Windows does**: WSADuplicateSocketW (socket transfer) needs the _target_ process id. GetNamedPipeClientProcessId/GetNamedPipeServerProcessId report the two ends' pids (Vista+).
- **How libuv handles it**: `uv__pipe_get_ipc_remote_pid` (pipe.c:1747-1761): lazily on first send: read client pid; if it equals GetCurrentProcessId() read server pid instead (covers same-process pipes used for thread "clustering": both queries return self, which is correct then). uv_pipe_open does the same eagerly for adopted ipc fds (pipe.c:2513-2519) with `assert(pid != -1)`. TODO comment admits a handshake would be sounder.
- **History**: Originally the parent pid was always used (broken for same-process); dfdecf00 (2015) enabled in-process write2; 357d28a2 (2022, #3766) introduced the client/server query method.
- **Bun disposition**: must-port if Bun supports node-style handle passing over IPC on Windows (it advertises child_process compat). Target: engine

## Bind / listen / accept

### [PIPE-21] Bind error remaps: ACCESS_DENIED→EADDRINUSE, PATH_NOT_FOUND/INVALID_NAME→EACCES

- **What Windows does**: CreateNamedPipe(FIRST_PIPE_INSTANCE) on an existing name returns ERROR_ACCESS_DENIED (not "busy"); an invalid pipe name (not under \\.\pipe, illegal chars) returns ERROR_PATH_NOT_FOUND or ERROR_INVALID_NAME.
- **How libuv handles it**: uv_pipe_bind2 (pipe.c:800-813). The EADDRINUSE remap makes Windows match Unix bind-on-existing-socket semantics; the EACCES remap is a coarse "bad name" signal.
- **History**: ee5236cf (2011) et seq; code stable for a decade.
- **Bun disposition**: must-port (node's net.Server.listen(pipeName) error-code compat depends on it). Target: engine

### [PIPE-22] Pre-created pseudo-accept pool: pending_instances (default 4), knob silently ignored after bind

- **What Windows does**: Named pipe servers have no real backlog; each concurrent client needs its own pre-created instance with a pending overlapped ConnectNamedPipe, else connects fail PIPE_BUSY.
- **How libuv handles it**: `uv_pipe_pending_instances` (pipe.c:713-718) sets the count only before bind (silently returns if UV_HANDLE_BOUND — calling later previously caused invalid memory, 4f4e9564) and marks PIPESERVER. bind allocates `accept_reqs[pending_instances]` (pipe.c:773-785); listen queues a ConnectNamedPipe on each (pipe.c:1255-1257); each completed accept immediately re-arms a fresh instance (pipe.c:1214-1216). uv_listen's `backlog` argument is ignored for pipes.
- **History**: 60630dab (2011) knob; 4f4e9564 (2015) post-bind ignore; default 4 (pipe.c:48).
- **Bun disposition**: must-port (without a pool, concurrent connects to a Bun pipe server fail PIPE_BUSY under load; keep the re-arm-on-accept invariant). Target: engine

### [PIPE-23] Server `handle->handle` is a rotating stash of the newest accept instance, exempt from the EBUSY guard, reset on close

- **What Windows does**: Nothing — internal bookkeeping hazard.
- **How libuv handles it**: pipe_alloc_accept stashes the newly created instance in handle->handle "for use from places such as getsockname and chmod" (pipe.c:582-585); on accept the stash is handed to the client and server->handle set INVALID until the next instance is created (pipe.c:1204-1215). `uv__set_pipe_handle` allows replacement only for PIPESERVER handles (34768a76); uv\_\_pipe_close closes every accept_reqs[i].pipeHandle then resets handle->handle = INVALID (9152b1bd) so endgame doesn't double-close a handle owned by an accept req.
- **History**: 34768a76 + 9152b1bd (2015, PR #488); 81264cfc (2022) fixed an ipc xfer item leak in accept.
- **Bun disposition**: must-port the _invariant_ (every instance handle has exactly one owner: either an accept req or a connection; the server's copy is a borrow). Bun's design should avoid the rotating-stash aliasing entirely — store the probe handle separately. Target: engine

### [PIPE-24] Accept completion while server is closing must free the instance handle exactly once

- **What Windows does**: Overlapped ConnectNamedPipe completions still arrive after CloseHandle of the instance (as aborted completions).
- **How libuv handles it**: `uv__process_pipe_accept_req` (pipe.c:2248-2280): when CLOSING, asserts req->pipeHandle was already closed/INVALIDed by uv**pipe_close and just drops the req count; on failure closes the instance and re-arms only if not closing. `uv**pipe_queue_accept` failure path inserts an error pending req so reqs_pending stays balanced (pipe.c:1131-1136).
- **History**: 7b16a3f5 (2013) "avoid assertion failure when pipe server is closed".
- **Bun disposition**: must-port (req/handle refcount balance on the close-during-accept path; classic UAF source). Target: engine

### [PIPE-25] Listening on an IPC pipe is disallowed; listen requires bound PIPESERVER; bind/listen after close → EINVAL

- **What Windows does**: Nothing — API-surface invariants.
- **How libuv handles it**: uv**pipe_listen (pipe.c:1224-1259): EINVAL for ipc handles (a6296880 — ipc connections are point-to-point; "accept" on ipc means take a transferred socket, PIPE-44), WSAEINVAL if not bound, WSAEISCONN if reading, ERROR_NOT_SUPPORTED if not PIPESERVER. uv_listen checks uv**is_closing first (stream.c:32-34; 8bcd689c). Re-listen with a new callback just swaps connection_cb (pipe.c:1228-1230).
- **History**: a6296880, 8bcd689c (#3641).
- **Bun disposition**: must-port (cheap guards; node test suite exercises them). Target: engine

### [PIPE-26] Pipe names: no length truncation on Windows; embedded NUL rejected; name copied with explicit terminator

- **What Windows does**: NT pipe names have no sockaddr_un-style 108-byte limit; long names simply fail at CreateFile/CreateNamedPipe time. Win32 W APIs stop at the first NUL.
- **How libuv handles it**: bind2/connect2 take (name, namelen), reject namelen==0 and embedded NULs (`includes_nul`, pipe.c:102-106), copy to a NUL-terminated buffer before UTF-8→UTF-16 (pipe.c:760-766, 931-937). UV_PIPE_NO_TRUNCATE is accepted but a no-op (35da5ded removed the 256-char check: "There is no length at which this gets truncated on Windows"). Unknown flag bits → EINVAL.
- **History**: 6be130e1 (2023, #4209: read past end of unterminated name buffer + bind error-path leak); 2f1614b1/35da5ded.
- **Bun disposition**: must-port (NUL rejection is a security boundary — C string truncation attacks; no artificial length cap). Target: engine

## Connect

### [PIPE-27] ERROR_PIPE_BUSY connect → worker thread loops WaitNamedPipeW(30s) + reopen + SwitchToThread

- **What Windows does**: All server instances busy → CreateFile fails ERROR_PIPE_BUSY. WaitNamedPipeW blocks until an instance is listening or timeout — but by the time you call CreateFile again another client may have grabbed it (inherent race), and WaitNamedPipeW can return success repeatedly while you keep losing.
- **How libuv handles it**: `pipe_connect_thread_proc` (pipe.c:832-871): `while (WaitNamedPipeW(name, 30000)) { open_named_pipe(); if ok break; SwitchToThread(); }` on a QueueUserWorkItem thread (WT_EXECUTELONGFUNCTION); gives up with the last error when WaitNamedPipeW itself fails/times out. The connect req is registered before queueing so close keeps the loop alive (18823270 fixed reqs_pending being incremented on the wrong thread/path — the original code "didn't function").
- **History**: 18823270 (2012); 831b15a4 (2011) earlier thread bug.
- **Bun disposition**: must-port (without the retry loop, concurrent connects to a busy server hard-fail; 30s matches NMPWAIT-style defaults; keep the lose-the-race reopen loop). Target: engine

### [PIPE-28] Worker thread may only write to the REQ; pipe handle setup is deferred to the loop thread; name is snapshotted into the req

- **What Windows does**: Nothing — pure data-race discipline.
- **How libuv handles it**: The slow-path thread fills `req->u.connect.pipeHandle/duplex_flags` only (pipe.c:859-865); `uv__process_pipe_connect_req` on the loop thread calls `uv__set_pipe_handle` (pipe.c:2294-2302), and if the handle started CLOSING meanwhile reports UV_ECANCELED and CloseHandles the fresh pipe. The target name is malloc-copied into `req->u.connect.name` before queueing (pipe.c:962-968) because `handle->name` can be freed by uv_close concurrently.
- **History**: ec677354 (2022, #3611: "only permitted to write to req on threads, as anything else causes data race corruption" + resource leaks when closing mid-connect); 3706c4f8 (2022, #3578: ECANCELED consistency + handle->name race).
- **Bun disposition**: must-port (thread-ownership rule and the ECANCELED path; this was a real-world crash/race cluster). Target: engine

### [PIPE-29] Connect errors are ALWAYS delivered asynchronously; sync-fail paths still register a pending req

- **What Windows does**: Nothing — callback-ordering contract.
- **How libuv handles it**: uv*pipe_connect2 error paths SET_REQ_ERROR + uv\_\_insert_pending_req + reqs_pending++ + REGISTER_HANDLE_REQ (pipe.c:1009-1014); uv_pipe_connect wraps connect2's hard errors the same way (pipe.c:883-890). Pre-checks: connect on PIPESERVER → ERROR_INVALID_PARAMETER, on already-connected → ERROR_PIPE_BUSY (pipe.c:939-946); failed UTF conversion → ERROR_NO_UNICODE_TRANSLATION. d843b7cf restored these errors being \_reported* after #4030 made "" fail synchronously without ever initializing/calling back.
- **History**: faca1402 (make uv_pipe_connect return void), d843b7cf (2023, #4202).
- **Bun disposition**: must-port (never invoke the connect callback synchronously — node's reentrancy assumptions; and never drop the callback on early validation failure). Target: engine

## Read path

### [PIPE-30] Zero-byte ReadFile as readiness probe; alloc_cb deferred until data is actually available

- **What Windows does**: An overlapped 0-length ReadFile on a byte-mode pipe completes (with 0 bytes) only when data is available in the pipe buffer or the pipe breaks — a poll-like primitive over IOCP. (uv*zero* static buffer, pipe.c:38-39.)
- **How libuv handles it**: `uv__pipe_queue_read` (pipe.c:1400-1458) issues the 0-read; on completion `uv__process_pipe_read_req` (pipe.c:2137-2194) loops calling alloc_cb + real reads (PIPE-31/33) while READING, then re-queues the next 0-read. Avoids holding user buffers across idle periods (UV's alloc_cb contract) and makes read_stop cheap.
- **History**: original design (pre-3a91232f, 2011), refined by 51e9dbc2 era "allow zero reads".
- **Bun disposition**: must-port (or consciously choose committed-buffer reads and document; if Bun keeps alloc-on-demand semantics for streams, the 0-read is the only way on pipes). Target: engine

### [PIPE-31] Post-readiness data read: overlapped ReadFile, and if IO_PENDING → CancelIoEx + GetOverlappedResult(wait=TRUE); ERROR_OPERATION_ABORTED counts as a 0-byte read

- **What Windows does**: With concurrent readers (another thread/process on the same pipe end, e.g. two libuv loops or an external reader), data observed by the 0-read can be consumed before your data read; a synchronous ReadFile would then block the loop forever. CancelIoEx + GetOverlappedResult(TRUE) waits for "completed or aborted", whichever the kernel decides.
- **How libuv handles it**: `uv__pipe_read_data` (pipe.c:2014-2037): overlapped ReadFile with hEvent|1; on success use the synchronous result; on ERROR_IO_PENDING immediately CancelIoEx (assert ok-or-ERROR_NOT_FOUND) and GetOverlappedResult(TRUE); a cancellation that raced a real completion still yields the data; pure ERROR_OPERATION_ABORTED is delivered to read_cb as 0 bytes (NOT an error, pipe.c:2041-2042). Replaced the old PeekNamedPipe-then-blocking-ReadFile scheme, which deadlocked with concurrent readers and double-paid a syscall.
- **History**: 727ee723 (2024-08, #4470). Old scheme: eb3f48eb (2015) "do not read more from stream than available" (assertion failures when more arrived than peeked).
- **Bun disposition**: must-port (this is the core read primitive; the deadlock it fixes is real for shared pipe ends — node cluster, inherited handles). Target: engine

### [PIPE-32] CancelIoEx can swallow concurrently-arrived data: gate the read loop on PeekNamedPipe (oven-sh fix; NOT upstream)

- **What Windows does**: Kernel race: data arriving concurrently with CancelIoEx can be drained from the pipe to satisfy the pending read and then discarded when the cancellation applies — the read reports ERROR_OPERATION_ABORTED with 0 bytes, but the bytes are gone from the pipe.
- **How libuv handles it**: Upstream v1.x/master still has `more = *bytes_read == max_bytes` (pipe.c:2037), so a full read loops straight into another ReadFile that may go pending on an empty pipe → CancelIoEx → potential silent data loss. The oven-sh fork (b028f871, 2026-04, Dylan) sets `more=1` only after PeekNamedPipe confirms bytes_available > 0 — then the next ReadFile completes synchronously and the cancel path is never entered.
- **History**: oven-sh b028f871; upstream has no equivalent as of v1.x 439a54be / master e1d6e62a (2026-06). Upstream master instead removed pipe shutdown and reworked write tracking but did not touch this.
- **Bun disposition**: must-port (data loss; Bun already ships this in its libuv fork — the Rust port must keep the peek gate or never issue a speculative read into an empty pipe). Target: engine

### [PIPE-33] Never run the data-read loop while a zero-read is pending (uv_read_stop+uv_read_start inside read_cb)

- **What Windows does**: Pipe reads complete in order; the kernel apparently cannot cancel a second read while the first is pending, so overlapping reads on one pipe deadlock; reusing the single embedded read_req OVERLAPPED for two in-flight ops corrupts memory.
- **How libuv handles it**: read loop condition `READING && !READ_PENDING` (pipe.c:2173-2174): if user code called uv_read_stop+uv_read_start inside read_cb (queuing a fresh zero-read), the loop stops issuing inline reads. libuv has exactly ONE read_req per stream — every protocol here assumes at most one outstanding read.
- **History**: 7026ae0f (2025-07, #4738/#4784) — regression introduced by the 727ee723 refactor; caused memory corruption on the OVERLAPPED + kernel deadlock.
- **Bun disposition**: must-port (single-in-flight-read invariant + reentrancy guard; trivially hit by node streams pausing/resuming in 'data'). Target: engine

### [PIPE-34] Non-overlapped pipes: PeekNamedPipe-bounded synchronous reads (admittedly racy), and \*bytes_read must be zero-initialized

- **What Windows does**: On a synchronous handle, an unbounded ReadFile blocks until data arrives — unacceptable on the loop thread. PeekNamedPipe returns bytes currently available (racy if another reader exists). ReadFile of 0 bytes is skipped entirely.
- **How libuv handles it**: pipe.c:1997-2013: PeekNamedPipe; clamp max_bytes to bytes_available; `*bytes_read = 0;` then `max_bytes == 0 || ReadFile(...)`; `more = max_bytes < bytes_available`. Comment admits the race ("in a race-y way however") — accepted because non-overlapped pipes can't do better without threads.
- **History**: c869cd1d (2024, #4511) restored this fallback after 727ee723 accidentally made blocking handles use the overlapped path (whole-process hang — "copied the bug from unix"); f00d4b67 + 0a00e80c fixed missing `r = ERROR_SUCCESS` / missing `*bytes_read = 0` (uninitialized out-param read as garbage byte count when max_bytes==0 path taken).
- **History detail**: the trio of follow-ups shows how easy this branch is to get wrong: out-params must be zeroed before conditional syscalls.
- **Bun disposition**: must-port (Bun will adopt non-overlapped stdio from cmd.exe et al; zero-init discipline is a checklist item for the Rust port). Target: engine

### [PIPE-35] Non-overlapped zero-"read": worker thread blocks in ReadFile(0); cancellation via three-state sentinel + CancelSynchronousIo spin

- **What Windows does**: CancelSynchronousIo(thread) cancels a synchronous I/O _currently blocked_ on that thread; it fails ERROR_NOT_FOUND if the thread hasn't entered the syscall yet or already left — so a single call is a race. GetCurrentThread() is a pseudo-handle; another thread must use a real (duplicated) handle.
- **How libuv handles it**: `uv_pipe_zero_readfile_thread_proc` (pipe.c:1263-1333) + `uv__pipe_interrupt_read` (pipe.c:1018-1062). Sentinel `readfile_thread_handle`: NULL = worker not yet started; real handle = worker about-to/inside ReadFile; INVALID*HANDLE_VALUE = cancelled-before-start (set by interrupter) or past-blocking (set by worker). Interrupter under the critical section: if NULL → preempt by storing INVALID; else spin `{ CancelSynchronousIo(thread); SwitchToThread(); }` until the worker stores INVALID. Worker: DuplicateHandle(GetCurrentThread()), under lock either observe INVALID (abort with ERROR_OPERATION_ABORTED before ever calling ReadFile) or publish its handle; after ReadFile it stores INVALID \_without* the lock (the interrupter holds the lock while spinning — the bare volatile write is what breaks the spin), then briefly Enter/Leave the lock so it cannot proceed to completion-posting while the interrupter is still inside its spin loop targeting this thread's I/O. `uv__pipe_queue_read` resets the sentinel to NULL before each queueing (pipe.c:1412).
- **History**: c42a4ca3 (2015, PR #1322: read*stop racing thread start → thread blocked in ReadFile after READING cleared); 4f60e0c1 (2018, PR #1843) redesigned: don't silently ignore ERROR_OPERATION_ABORTED globally (c42a4ca had treated it as EINTR-like "not an error" — false premise; aborts only happen when \_we* abort), don't mark aborted reads successful, let the MAIN thread restart cancelled reads instead of the worker retrying (simpler sync), assume CancelIo/CancelSynchronousIo exist (XP dropped).
- **Bun disposition**: must-port (the full protocol incl. the unlocked release store and the post-clear lock handshake; shortcuts here deadlock or cancel the _next_ read). Target: engine

### [PIPE-36] uv_read_stop interrupts the in-flight readiness read immediately; CANCELLATION_PENDING dedupes

- **What Windows does**: A pending 0-read otherwise survives read_stop and completes later (possibly after the user expected silence), and CancelIoEx of an already-completed op returns ERROR_NOT_FOUND.
- **How libuv handles it**: `uv__pipe_read_stop` (pipe.c:1065-1069) → `uv__pipe_interrupt_read`: CancelIoEx(handle, &read_req.overlapped) for overlapped (assert ok-or-NOT_FOUND), the PIPE-35 protocol for sync; sets UV_HANDLE_CANCELLATION_PENDING so repeated stops/closes don't double-cancel (pipe.c:1023-1024, 1060-1061); flag cleared together with READ_PENDING when the aborted req drains (pipe.c:2145). ERROR_OPERATION_ABORTED on the zero-read is swallowed unless the user restarted reading (pipe.c:2164-2168: "error isn't relevant to the user; we'll start a new zero-read").
- **History**: 837c62c7 (2014) "make uv_read_stop immediately stop reading"; 0f53cd05 (2018, nodejs/node#19377) added the CancelIoEx for overlapped pipes (before that only sync reads were interruptible).
- **Bun disposition**: must-port (read_stop must be synchronously effective: node relies on pause() semantics; also required for getname, PIPE-53). Target: engine

### [PIPE-37] ERROR_BROKEN_PIPE on read = EOF, not error; on write = EPIPE; ERROR_NO_DATA on write = EPIPE

- **What Windows does**: Reading a pipe whose write end closed fails ERROR_BROKEN_PIPE (109). Writing to a pipe whose read end closed fails ERROR_NO_DATA (232, "the pipe is being closed") or ERROR_BROKEN_PIPE.
- **How libuv handles it**: read side: `uv__pipe_read_error_or_eof` (pipe.c:1908-1915) maps BROKEN_PIPE→UV_EOF, everything else through uv_translate_sys_error. write side: `uv_translate_write_sys_error` (src/win/error.c:176-183) maps BROKEN_PIPE and NO_DATA → UV_EPIPE; applied only on stream write paths (stream.c:158,194).
- **History**: long-standing; the dedicated write translator exists precisely because ERROR_NO_DATA's default mapping is not EPIPE.
- **Bun disposition**: must-port (exact node error-code compat: EPIPE on write-after-close, 'end' on read). Target: engine

### [PIPE-38] Reading again after EOF is permitted (flags are not poisoned)

- **What Windows does**: Nothing — API contract choice.
- **How libuv handles it**: `uv__pipe_read_eof` calls uv_read_stop but leaves UV_HANDLE_READABLE set (pipe.c:1884-1893), so uv_read_start after EOF re-queues a 0-read (which will instantly EOF again on pipes, but TTYs can produce more data).
- **History**: b2614a10 (2021, #3361) relaxed ce15b840's "EOF is terminal" constraint.
- **Bun disposition**: should-port (node streams don't usually re-read pipes after EOF, but the shared stream layer must not assert; relevant mostly to TTY cross-ref). Target: engine

### [PIPE-39] Read sizing: 65536 suggested per alloc_cb, INT32_MAX hard cap per call, UV\_\_IO_MAX_BYTES = 0x7ffff000 global clamp

- **What Windows does**: ReadFile/WriteFile take DWORD lengths; NT additionally caps single I/O transfers; giant buffers risk sign confusion in 32-bit fields.
- **How libuv handles it**: `bytes_requested = 65536` per loop iteration (pipe.c:2175); data reads bounded by min(user buf, max_bytes, available, UV**IO_MAX_BYTES) (pipe.c:1986-1995); writes reject a single buffer > UV**IO_MAX_BYTES with EINVAL (pipe.c:1643-1644); `uv__check_before_write` rejects nbufs > 1024\*1024 ("catch sign conversion bugs" — negative int → huge unsigned) and total > UV\_\_IO_MAX_BYTES (stream.c:114-134). 0x7ffff000 mirrors Linux MAX_RW_COUNT.
- **History**: fa0ac9ec (2026, #5076) "make libuv 64-bit safe".
- **Bun disposition**: must-port (clamps + the nbufs sanity check; Bun marshals user-controlled buffer arrays from JS). Target: engine

## Write path

### [PIPE-40] Four distinct write strategies keyed off (NON_OVERLAPPED, BLOCKING_WRITES); the blocking+overlapped one is suspect

- **What Windows does**: Synchronous handles block WriteFile; overlapped handles complete via IOCP/event; you cannot mix freely.
- **How libuv handles it**: `uv__pipe_write_data` (pipe.c:1596-1744): (1) BLOCKING+NON_OVERLAPPED → synchronous WriteFile inline, then POST_COMPLETION_FOR_REQ to deliver the callback through the loop (pipe.c:1646-1665); (2) NON_OVERLAPPED → serialized worker queue (PIPE-41); (3) BLOCKING (overlapped handle) → overlapped WriteFile with hEvent|1 + WaitForSingleObject(event, INFINITE), then registers the req and returns... but with hEvent's low bit set no IOCP packet is generated and the code neither posts nor inserts a pending req (pipe.c:1676-1712) — analysis says the write callback can never fire on this path (write_reqs_pending leaks → shutdown/close hang); (4) plain overlapped → IOCP (or inline-pending via SYNC_BYPASS, PIPE-18).
- **History**: 92040eb7 (2013) added uv_stream_set_blocking (pipe-only; for node stdio data-integrity-at-exit). c7ebe68f (2015) removed a double-completion (back then the event had NO low bit so the kernel DID post a packet; the manual POST duplicated it; also "waiting on the wrong event" — it waited on the ipc header req's event). 618c9212 (PR #2620) consolidated overlapped init and switched path (3) to the |1 event — which by MSDN suppresses the packet, apparently regressing path (3) silently; path is nearly dead in practice because blocking writes are normally requested on non-overlapped stdio (path 1). Upstream master (e1d6e62a) has the same shape.
- **Bun disposition**: must-port paths 1/2/4. For path 3: do NOT copy blindly — either complete inline (post to loop after the wait, like path 1) or reject blocking mode on overlapped pipes; verify empirically. Target: engine

### [PIPE-41] Non-overlapped writes are serialized through a circular-tail queue, one worker-thread WriteFile at a time

- **What Windows does**: Concurrent synchronous WriteFiles on one pipe handle from multiple pool threads can interleave/block unboundedly; thread-pool exhaustion looms if each write takes a thread.
- **How libuv handles it**: singly-linked circular queue with tail pointer `non_overlapped_writes_tail` (pipe.c:1488-1521); a write is queued and a QueueUserWorkItem worker (`uv_pipe_writefile_thread_proc`, pipe.c:1336-1359) is dispatched only when write_reqs_pending was 0 (pipe.c:1666-1672); each completion dispatches the next queued write from the loop thread (pipe.c:2234-2238). Result: at most one worker thread per pipe, writes complete in order. QueueUserWorkItem failure is fatal (pipe.c:1530).
- **History**: 54982a23 (2011).
- **Bun disposition**: must-port (ordering guarantee + bounded thread usage for non-overlapped stdio writes). Target: engine

### [PIPE-42] Vectored writes are coalesced into ONE heap buffer with an embedded shadow uv_write_t; callback receives the user's req back

- **What Windows does**: WriteFile has no scatter/gather for pipes (WriteFileGather is for unbuffered disk files); each WriteFile is a separate kernel op and interleaves with the peer's writes.
- **How libuv handles it**: `uv__build_coalesced_write_req` (pipe.c:1536-1593): single malloc holds {shadow uv_write_t copied from user req, pointer to user req, concatenated data}; the shadow req (marked `coalesced = 1`) is what goes through the kernel/loop; on completion `uv__process_pipe_write_req` unwraps via container_of, frees the heap block, and invokes the callback with the ORIGINAL user req pointer (pipe.c:2222-2227). Total data > UINT32_MAX → WSAENOBUFS (UV_ENOBUFS). nbufs==1 writes go direct with zero copy unless copy_always (IPC).
- **History**: 12733dd4 (2018, #794 — before this, uv_write with nbufs>1 on pipes failed/был broken).
- **Bun disposition**: must-port (node writev on pipes; the swap-back trick matters because callers identify completions by req pointer). Single-frame atomicity also matters for IPC (PIPE-45). Target: engine

### [PIPE-43] uv_try_write on pipes returns UV_EAGAIN — a real implementation was shipped and REVERTED for breaking node IPC

- **What Windows does**: There is no non-blocking write probe on overlapped pipes short of issuing-and-cancelling, which interacts with write ordering.
- **How libuv handles it**: stream.c:216-217 returns UV_EAGAIN for UV_NAMED_PIPE; uv_try_write2 with a send_handle always UV_EAGAIN (stream.c:229-231). 244e0e20 + e1143f12 (2023) implemented try_write via the issue-then-CancelIoEx pattern; both reverted within the release cycle (07261493, 03bb7037: "For some reason this is breaking node.js IPC").
- **History**: PR #3825 + reverts (#4003). The 727ee723 author later noted the new read pattern would permit a correct implementation, but nobody has retried.
- **Bun disposition**: must-port the EAGAIN behavior; skip implementing try_write for pipes (recorded reason: upstream's attempt broke node IPC in ways never diagnosed; node falls back to async write on EAGAIN anyway). Target: engine

### [PIPE-44] Zero-length writes are real operations (empty WriteFile), and write_queue_size accounting only counts kernel-queued bytes

- **What Windows does**: WriteFile of 0 bytes on a pipe succeeds (and is visible to the peer as a 0-byte read only in message mode; in byte mode it is a no-op) — but the request must still flow through the completion machinery.
- **How libuv handles it**: nbufs==0 → uv*null_buf* written (pipe.c:1629-1631); queued_bytes = 0 for synchronously-completed writes, = len only when the kernel queued it (handle->write_queue_size += / -= symmetric, pipe.c:1719-1724, 2203-2204). 0a00e80c showed zero-byte writes reach surprising branches (the peek path with max_bytes==0).
- **History**: 1acbd768 "don't read/recv if buf.len==0"; c7ebe68f fixed queued_bytes accounting to bufs[0].len.
- **Bun disposition**: must-port (uv_stream_get_write_queue_size semantics and the "synchronous completion = 0 queued" rule; node backpressure reads this). Target: engine

## IPC protocol

### [PIPE-45] IPC frame header is EXACTLY 16 bytes with a frozen layout for cross-version node compatibility

- **What Windows does**: Nothing — libuv wire protocol.
- **How libuv handles it**: `uv__ipc_frame_header_t {u32 flags; u32 reserved1; u32 data_length; u32 reserved2}` with STATIC_ASSERT(==16) (pipe.c:73-84). Flags: HAS_DATA=0x01, HAS_SOCKET_XFER=0x02, XFER_IS_TCP_CONNECTION=0x04; unknown flag bits or nonzero reserved2 or data_length-without-HAS_DATA → frame invalid → read error WSAECONNABORTED (pipe.c:2077-2105, 2127-2129). The layout is bit-compatible with the pre-1.21 `{int flags; uint64 raw_data_length}` (flags at 0, low length dword at 8, alignment padding at 4, high dword at 12 must be 0) and the flag VALUES match the old UV_IPC_RAW_DATA/UV_IPC_TCP_SERVER/UV_IPC_TCP_CONNECTION (0x1/0x2/0x4).
- **History**: libuv 1.21.0 (4e53af91) shipped an incompatible 8-byte `{type, payload_length}` header; mixed-version node parent/child IPC broke instantly (libuv#1922, nodejs/node#21671); 27ba6628 (1.22.0) restored wire compat and added the STATIC_ASSERTs.
- **Bun disposition**: must-port byte-for-byte (Bun's child_process IPC interoperates with node children using libuv; reserved2 validation included — it doubles as corruption detection). Target: engine

### [PIPE-46] An IPC frame (header + optional 632-byte socket info + payload) is written as ONE coalesced WriteFile — split writes deadlock

- **What Windows does**: Byte-mode pipe writes from one WriteFile are contiguous, but two separate WriteFiles can block independently; if both pipe ends write frame headers synchronously while both kernel buffers are full, neither reads → classic deadlock.
- **How libuv handles it**: `uv__pipe_write_ipc` (pipe.c:1764-1863) builds bufs = [header, xfer_info?, data...] (stack array up to 6, else heap) and calls uv\_\_pipe_write_data with copy_always=1 → everything is coalesced into one heap buffer (PIPE-42) and one async WriteFile. Pre-1.21, the header was written SYNCHRONOUSLY before the payload; that was the deadlock.
- **History**: 4e53af91 (2018, libuv#1099; downstream: nodejs/node#7657, electron#10107, parcel#637/#900/#1137 — "IPC deadlock under heavy traffic").
- **Bun disposition**: must-port (single-buffer frame writes, always copied — header/xfer live on the stack). Target: engine

### [PIPE-47] Socket transfer payload is WSAPROTOCOL_INFOW (628) + u32 delayed_error = exactly 632 bytes, keyed to the REMOTE pid

- **What Windows does**: WSADuplicateSocketW serializes a socket for a specific target pid; importing via WSASocketW(FROM_PROTOCOL_INFO). The info blob is Unicode-variant sized (W not A) — mixing breaks the 632 assert.
- **How libuv handles it**: `uv__ipc_socket_xfer_info_t` (src/win/internal.h:70-73) + STATIC_ASSERT(==632) (pipe.c:84). Export at send (uv**tcp_xfer_export, tcp.c — cross-ref TCP) using uv**pipe_get_ipc_remote_pid (PIPE-20); xfer_type encoded in frame flags (server vs connection — connection import differs); only UV_TCP send_handles supported, anything else ERROR_NOT_SUPPORTED (pipe.c:1789-1794) — Windows libuv cannot pass pipes over pipes (unlike Unix fd passing).
- **History**: 70925c3b (2012) enabled TCP-over-IPC; c3daa44c disallowed non-listening/non-connected sockets; 6d3a051e relays TCP bind errors via `delayed_error`.
- **Bun disposition**: must-port for node cluster/child_process socket passing; the "TCP only" limitation must be surfaced as a clear error. Target: engine

### [PIPE-48] IPC header/xfer reads use blocking read-exactly; therefore the IPC read loop must NEVER speculate (`more` only while payload remains)

- **What Windows does**: After the zero-read signals ≥1 byte, the rest of a frame may still be in flight; ReadFile returns partial data. A blocking "read exactly N" only terminates if the peer eventually sends N bytes.
- **How libuv handles it**: `uv__pipe_read_exactly` (pipe.c:1939-1965) loops overlapped ReadFile + GetOverlappedResult(TRUE) until count bytes. Safe only because the peer writes whole frames atomically (PIPE-46). `uv__pipe_read_ipc` returns more=1 ONLY while `payload_remaining > 0` (pipe.c:2120-2125) — after a complete frame it must return 0 and wait for the next zero-read, because calling read_exactly with no data in flight hangs the loop.
- **History**: f55efb2f (2024, #4548 — yet another #4470-refactor followup: the refactor set more=1 after frame headers, hanging node IPC).
- **Bun disposition**: must-port (the state machine boundary: header+xfer consumed synchronously, payload streamed via normal reads with `payload_remaining` countdown; never speculative-read across a frame boundary). Note for hardening: a malicious/broken peer that writes a partial header blocks the loop thread — acceptable for trusted parent/child IPC only; Bun should keep IPC pipes private (PIPE-02 LOCAL\ names + default DACL). Target: engine

### [PIPE-49] Transferred sockets queue in ipc_xfer_queue until uv_accept; endgame must materialize-and-close unclaimed ones

- **What Windows does**: A WSADuplicateSocketW blob holds kernel socket state alive for the target process; dropping the blob without importing leaks the socket system-wide until the target exits.
- **How libuv handles it**: incoming xfer infos are queued (`uv__pipe_queue_ipc_xfer_info`, pipe.c:1918-1933; malloc failure fatal); `uv__pipe_accept` for ipc pops the queue and imports (pipe.c:1171-1188); `uv_pipe_pending_count/uv_pipe_pending_type` expose it (UV_TCP only, pipe.c:2619-2670); `uv__pipe_endgame` drains leftovers by importing via WSASocketW(FROM_PROTOCOL_INFO, WSA_FLAG_OVERLAPPED|WSA_FLAG_NO_HANDLE_INHERIT) then closesocket (pipe.c:671-691).
- **History**: b05a3ee4 "allow queueing pending handles"; d19855c7 (2026) added WSA_FLAG_NO_HANDLE_INHERIT everywhere (handle-inheritance leak class); 81264cfc fixed the accept-path item leak.
- **Bun disposition**: must-port (socket leak on close-with-pending-handles; include NO_HANDLE_INHERIT). Target: engine

## Shutdown / EOF

### [PIPE-50] uv_shutdown probe: FilePipeLocalInformation, "all data read" == (OutboundQuota == WriteQuotaAvailable); else FlushFileBuffers on a worker

- **What Windows does**: Named pipes have NO half-close/shutdown primitive. FlushFileBuffers on a pipe BLOCKS until the peer has read everything in the buffer (or breaks). WriteQuotaAvailable in FILE_PIPE_LOCAL_INFORMATION = remaining outbound quota; equal to OutboundQuota iff the peer drained all written bytes. Querying needs FILE_READ_ATTRIBUTES (hence PIPE-05/06 access dance).
- **How libuv handles it**: `uv__pipe_shutdown` (pipe.c:612-659): runs only after write_reqs_pending hits 0 (stream.c:253-258, pipe.c:2240-2242); NtQueryInformationFile(FilePipeLocalInformation); if quotas equal → complete shutdown immediately (skip the worker); else QueueUserWorkItem(`pipe_shutdown_thread_proc` → FlushFileBuffers + POST_COMPLETION, pipe.c:591-609). On probe/queue failure: SET_REQ_ERROR and `handle->flags |= UV_HANDLE_WRITABLE; /* Questionable. */` (pipe.c:637,655 — restores writability so the user can retry; marked dubious by the authors).
- **History**: 39aac4a5 (2011) "better shutdown for pipes"; 5d210562 "make sure shutdown_cb is always called"; ee970e38 (2022, #3649) moved dispatch out of endgame; 7bccb562 replaced UV_HANDLE_SHUTTING with shutdown_req presence check.
- **Bun disposition**: must-port in some form: node's `socket.end()` / process.stdout flush-before-exit semantics on Windows depend on "don't destroy until peer read everything". But see PIPE-52 — upstream v2 deleted ALL of this; Bun should implement flush-on-shutdown deliberately (probe short-circuit is a worthwhile optimization to avoid burning a thread per shutdown). Target: engine

### [PIPE-51] After shutdown completes, wait for peer EOF with a 50 ms unref'd timer, then force-close; guard against IOCP backlog with HasOverlappedIoCompleted

- **What Windows does**: After you flush, the polite close sequence is: peer reads everything, peer sees your close as EOF... but the peer may never close its end, and there is no FIN. Closing immediately after flush can still discard the peer's in-flight data toward you.
- **How libuv handles it**: `uv__process_pipe_shutdown_req` (pipe.c:2315-2355): if handle still READABLE, init + start `eof_timer` (50 ms, pipe.c:46) instead of closing — gives the remote a window to send its last data; if NOT readable (write-only pipe) close immediately (61b20e8d). Timer is heap-allocated, unref'd (doesn't hold the loop alive), destroyed via uv_close with a free-in-close_cb (pipe.c:2358-2439; 150dfdd0 fixed an assert destroying it). `eof_timer_cb` re-checks `HasOverlappedIoCompleted(&read_req.overlapped)` because with a busy IOCP the read completion may already be queued but not yet processed — in that case do nothing (pipe.c:2404-2411). Otherwise close_pipe (force both ends off), uv_read_stop, and deliver UV_EOF (even if the user stopped reading — "TODO: is that okay?"). Timer restarts on every queued read while a shutdown req exists (eof_timer_start in uv\_\_pipe_queue_read, pipe.c:1447).
- **History**: 39aac4a5 (2011); 150dfdd0 (2015).
- **Bun disposition**: ported, with one deliberate deviation: the grace timer is stopped in `read_stop` and re-armed in `read_start`, so it can never fire while the reader is stopped — libuv instead leaves it running and delivers UV_EOF to a stopped reader (its own "TODO: is that okay?"), which in the engine's stash model would manufacture the impossible stash+read_pending state. The HasOverlappedIoCompleted re-check is ported as `completed_volatile`. Target: engine

### [PIPE-52] Upstream v2 REMOVED pipe shutdown entirely (uv_shutdown on pipes → UV_ENOTSOCK) calling the hack "unsound"

- **What Windows does**: (As above — no real shutdown primitive.)
- **How libuv handles it**: libuv master 064617e4 (2026-03-16): deleted eof_timer, FlushFileBuffers worker, FilePipeLocalInformation probe (-225 lines); uv_shutdown now fails immediately with UV_ENOTSOCK for UV_NAMED_PIPE, matching Unix shutdown(2) on a pipe fd. v1.x keeps the hack for compatibility.
- **History**: 064617e4 ("Named pipes do not actually support shutdown, and this hack to fake it was unsound").
- **Bun disposition**: decision-required: must-pick-one. If Bun mirrors v1.x semantics (node on libuv v1 expects shutdown-with-flush), port PIPE-50/51; record that upstream's future direction is ENOTSUP + explicit flush by the embedder. Do NOT silently ship neither. Target: engine

## Close / endgame / lifetime

### [PIPE-53] uv_pipe_getname must interrupt a pending synchronous read first — NtQueryInformationFile deadlocks behind a blocked ReadFile

- **What Windows does**: NtQueryInformationFile serializes with in-flight synchronous I/O on the same file object: if a worker thread is blocked in ReadFile on a non-overlapped pipe, the query blocks until data arrives.
- **How libuv handles it**: `uv__pipe_getname` (pipe.c:2549-2557) calls uv\_\_pipe_interrupt_read for CONNECTION+NON_OVERLAPPED handles before querying FileNameInformation; the loop will re-queue the read afterwards. Also: two-call STATUS_BUFFER_OVERFLOW dance for the variable-length name (pipe.c:2559-2577); result is the device-relative name (e.g. `\uv\123-456`) so libuv prepends `\\?\pipe` (pipe_prefix, pipe.c:50-52, 2602-2611); bound servers short-circuit to the cached `handle->name`.
- **History**: 5ac214c7 added getsockname; 9d94fd97 fixed a leak; 1e59ab1d/2606ba22/e5f4b798 nailed down the no-trailing-NUL-in-exact-buffer + ENOBUFS-counts-NUL conventions.
- **Bun disposition**: must-port (the interrupt-before-query rule; otherwise `server.address()` can hang a worker-fed pipe). Target: engine

### [PIPE-54] Close sequence ordering: interrupt read → free name → close server instances → destroy eof timer → close connection handle → endgame when reqs drain

- **What Windows does**: CloseHandle with overlapped I/O outstanding completes those ops with STATUS*CANCELLED \_eventually*; the OVERLAPPED structures must stay alive until then.
- **How libuv handles it**: `uv__pipe_close` (pipe.c:1074-1122) in exactly that order; close_pipe only for CONNECTION handles (servers closed per-instance); endgame deferred until reqs_pending == 0 (DECREASE_PENDING_REQ_COUNT, handle-inl.h:51-60) because the embedded read_req/OVERLAPPED lives inside uv_pipe_t. `uv__pipe_endgame` (pipe.c:662-710) then drains the ipc xfer queue (PIPE-49), asserts the read wait_handle was unregistered, closes the read event, DeleteCriticalSection for non-overlapped pipes, frees accept_reqs.
- **History**: ec677354 (lifetime bugs cluster), cf05c5f0 (ECANCELED on premature close).
- **Bun disposition**: must-port (the deferred-free-until-all-completions-drain rule is THE Windows-async-close rule; Bun's Rust handle Drop must model reqs_pending). Target: engine

### [PIPE-55] Request status is stored IN the OVERLAPPED.Internal field as an NTSTATUS, with a hand-rolled NTSTATUS_FROM_WIN32 because "the DDK got it wrong"

- **What Windows does**: The kernel itself stores the completion NTSTATUS in OVERLAPPED.Internal and the byte count in InternalHigh. The DDK's NTSTATUS_FROM_WIN32 macro has a casting bug.
- **How libuv handles it**: req-inl.h:31-53: SET_REQ_ERROR writes `NTSTATUS_FROM_WIN32(err)` into Internal (libuv's own macro, src/win/winapi.h:4079-4086, warning-severity encoding so NT_SUCCESS is false); REQ_SUCCESS = NT_SUCCESS(Internal); GET_REQ_ERROR converts back via RtlNtStatusToDosError. This means thread-pool reqs (which set status manually) and kernel-completed reqs (where the kernel wrote a real NTSTATUS like STATUS_BROKEN_PIPE) flow through ONE status channel. POST_COMPLETION_FOR_REQ (req-inl.h:76-82) posts the req's own OVERLAPPED pointer to the loop IOCP — uv_fatal_error if PostQueuedCompletionStatus fails.
- **History**: code comment ("because the DDK got it wrong!"); design since the 2011 split.
- **Bun disposition**: must-port the _unification idea_ (one completion pathway; status convertible both directions). Bun can use its own req repr, but must preserve: kernel NTSTATUS → Win32 error mapping for completions, and manual completions must be indistinguishable downstream. Target: engine

### [PIPE-56] uv\_\_get_osfhandle must suppress the debug-CRT invalid-fd assertion dialog

- **What Windows does**: `_get_osfhandle(bad_fd)` in debug CRT builds raises an assertion dialog/abort instead of returning INVALID_HANDLE_VALUE (release builds return it fine).
- **How libuv handles it**: handle-inl.h:98-110 wraps the call in UV_BEGIN/END_DISABLE_CRT_ASSERT so invalid fds are reported as UV_EBADF instead of crashing debug builds.
- **History**: c0716b3d (2013) "improved handling of invalid FDs".
- **Bun disposition**: should-port (only relevant if Bun links the debug CRT in dev builds or calls \_get_osfhandle on user-supplied fds — it does via uv_pipe_open-equivalents; Rust's libc CRT bindings hit the same assert). Target: engine

### [PIPE-57] uv_guess_handle: FILE_TYPE_PIPE covers BOTH pipes and sockets; FILE_TYPE_CHAR is TTY only if GetConsoleMode succeeds

- **What Windows does**: GetFileType returns FILE_TYPE_PIPE for anonymous/named pipes AND sockets; FILE_TYPE_CHAR for console handles AND NUL AND serial ports. GetConsoleMode succeeds only on real console handles.
- **How libuv handles it**: handle.c:31-58: fd<0 → UNKNOWN (f43f1a70 crash fix); CHAR+GetConsoleMode → UV_TTY else UV_FILE (NUL lands here); PIPE → UV_NAMED_PIPE (sockets intentionally lumped in — node stdio over sockets is treated as a pipe and later code distinguishes via NtQueryInformationFile failures); DISK → UV_FILE.
- **History**: f43f1a70 (2012).
- **Bun disposition**: must-port (process.stdin type detection matrix; cross-ref: TTY for the console path, PROCESS for stdio classification). Target: engine

### [PIPE-58] Read/write/accept failure paths must still flow through the pending-req machinery (count parity), never early-return

- **What Windows does**: Nothing — internal invariant.
- **How libuv handles it**: every queue function's error path does SET_REQ_ERROR + uv\_\_insert_pending_req + (READ_PENDING) + reqs_pending++ (pipe.c:1452-1457 reads; 1131-1136 accepts; 1009-1014 connects) so the close/endgame accounting and user callbacks see a uniform stream of completions. 046aebe7 consolidated the read error path to one label specifically to keep GetLastError() capture adjacent to the failure.
- **History**: shape stable since 2011; reasserted by 046aebe7.
- **Bun disposition**: must-port (in Rust terms: the error arm of every submit produces the same completion event the success arm eventually would; no synchronous error callback). Target: engine

### [PIPE-59] uv_pipe_chmod edits the kernel object DACL for Everyone, requiring WRITE_DAC at creation, with the same asymmetric attribute grants

- **What Windows does**: Named pipe access is a real security descriptor on the kernel object; granting "read" usefully requires GENERIC_READ|FILE_WRITE_ATTRIBUTES (so the grantee can SetNamedPipeHandleState) and "write" requires GENERIC_WRITE|FILE_READ_ATTRIBUTES (so the grantee can probe for shutdown) plus SYNCHRONIZE.
- **How libuv handles it**: uv_pipe_chmod (pipe.c:2672-2747): AllocateAndInitializeSid(WORLD), GetSecurityInfo(SE_KERNEL_OBJECT, DACL), SetEntriesInAcl(SET_ACCESS for Everyone), SetSecurityInfo; operates on handle->handle — for servers that's the stashed newest instance (PIPE-23), and chmod applies per-OBJECT so all instances of the name share it. WRITE_DAC was added to every CreateNamedPipe/CreateFile precisely so this works (fd02ab68).
- **History**: fd02ab68 (2017, PR #1386) — node's `net.Server.listen({writableAll})` / docker-CLI-style pipe sharing.
- **Bun disposition**: should-port (needed only if Bun exposes pipe chmod/writableAll; the WRITE_DAC-at-creation prerequisite must be ported NOW though, or chmod can never be added without breaking handle compat). Target: engine

### [PIPE-60] uv\_\_once_init() must run before any pNt\* call — pipe code is reachable before a loop exists

- **What Windows does**: Nothing — lazy-init hazard. libuv resolves NtQueryInformationFile/RtlNtStatusToDosError from ntdll at runtime into pNt*/pRtl* pointers.
- **How libuv handles it**: uv*pipe_open and uv**pipe_getname call uv**once_init() explicitly (pipe.c:2458, 2535) because they can run before/without full loop init (165c63b9, #1488 — crash when uv_fs*\* style entry points ran first).
- **History**: 165c63b9 (2017).
- **Bun disposition**: skip the mechanism (Bun's Rust layer can link ntdll imports statically — NtQueryInformationFile is a stable documented-enough export on 1809+; no GetProcAddress needed). Record: the _information classes_ used (FileModeInformation=16, FileAccessInformation=8, FilePipeLocalInformation=24, FileNameInformation=9) are the load-bearing part. Target: engine

### [PIPE-61] DECREASE/INCREASE_ACTIVE_COUNT and handle-closing macro subtleties

- **What Windows does**: Nothing — loop bookkeeping.
- **How libuv handles it**: handle-inl.h:32-60: active count drops trigger uv**handle_stop only when not CLOSING; uv**handle_closing (63-73) asserts not already closing, force-adds the handle to the active set when it wasn't active+ref'd (so the close callback keeps the loop alive exactly once), clears ACTIVE; uv\_\_handle_close (76-85) removes from queue, marks CLOSED, fires close_cb. uv_close on an already-closing handle asserts (handle.c:70-73) — double-close is a programmer error, not recoverable.
- **History**: 9efa8b35 reference counting rework (2012); 637be161 made active and closing independent.
- **Bun disposition**: must-port semantics (loop-alive rules during close; double-close = panic in debug, documented UB-ish in release). Target: engine

### [PIPE-62] uv_stream_set_blocking is pipe-only and toggles a flag with NO synchronization with in-flight writes

- **What Windows does**: Nothing — API contract.
- **How libuv handles it**: stream.c:274-284: EINVAL for non-pipes; sets/clears UV_HANDLE_BLOCKING_WRITES. Docs (uv.h) warn it must be set immediately after open/creation, before any write — libuv does not drain existing async writes before going blocking (ordering between the modes is unspecified).
- **History**: 92040eb7 (2013); node uses it for stdio fds so `console.log` data survives `process.exit()`.
- **Bun disposition**: must-port the capability (Bun needs deterministic stdout flush on exit on Windows) but Bun may instead implement "flush all pending on exit" at a higher layer; record the choice. Target: engine
