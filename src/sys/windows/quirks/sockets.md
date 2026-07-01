# libuv Windows institutional knowledge — SOCKETS (tcp.c, udp.c, winsock.c)

Source worktree: `C:/Users/dylan/code/libuv-read` (line refs are into that tree).
Bun baseline: Windows 10 1809+. Bun uses uSockets for TCP/UDP data plane, but the AFD
poll backend, named pipes, IPC socket transfer, and any direct winsock use hit all of this.

### [SOCK-01] Initialize winsock once per process, never clean up
- **What Windows does**: Every winsock call fails with WSANOTINITIALISED until `WSAStartup` runs. WSAStartup/WSACleanup are refcounted per process; calling cleanup while sockets are alive breaks everything.
- **How libuv handles it**: `uv__winsock_init` (src/win/winsock.c:78-101) calls `WSAStartup(MAKEWORD(2,2))` exactly once from the win32 one-time init, fatal-errors on failure, and never calls `WSACleanup` (process-lifetime ownership). It also pre-builds the wildcard `0.0.0.0:0` / `[::]:0` sockaddrs used for implicit binds (winsock.c:85-92).
- **History**: d1a63c40 "win: move winsock intialization out of tcp.c" — originally TCP-local, became process-global because pipes/poll need it too.
- **Bun disposition**: must-port. Target: engine

### [SOCK-02] Don't abort in Windows Safe Mode (no networking)
- **What Windows does**: In Safe Mode without networking, `WSAStartup` or the first `WSASocketW` fails; a hard abort means the program can't start at all.
- **How libuv handles it**: `if (1 == GetSystemMetrics(SM_CLEANBOOT)) return;` skips all winsock init in safe mode (winsock.c:95). Sockets later fail naturally with normal errors instead of aborting at startup.
- **History**: af31d014 "win: skip winsock initialization in safe mode" (PR #2205) — libuv-based apps previously could not start in safe mode because `uv_winsock_init` aborted.
- **Bun disposition**: should-port. Target: engine

### [SOCK-03] Detect non-IFS LSPs at startup; assume the worst if detection fails
- **What Windows does**: Layered Service Providers (LSPs — old-school firewalls/AV/proxies) can stack on the TCP/UDP providers. A *non-IFS* LSP's SOCKET is not a real kernel file handle: `ReadFile`-family fast paths, `SetFileCompletionNotificationModes`, and `CancelIo` on it misbehave or break.
- **How libuv handles it**: At init it creates throwaway IPv4 and IPv6 TCP sockets, reads `SO_PROTOCOL_INFOW`, and checks `dwServiceFlags1 & XP1_IFS_HANDLES` (winsock.c:103-135), caching `uv_tcp_non_ifs_lsp_ipv4/ipv6` globals. Critically the flags **default to 1 (LSP present)** and are only cleared to 0 on positive proof of IFS handles — so socket-creation failure (no IPv4 stack) or getsockopt failure degrades to the safe/slow path instead of crashing.
- **History**: cfe14452 — `uv_winsock_init` used to `uv_fatal_error` when the IPv4 dummy socket couldn't be created (machines with no IPv4 stack: "(10047) An address incompatible with the requested protocol"). e1fad5a3 (issue #1425, PR #2600) removed a remaining abort when detection failed. c0e70448 "avoid IOCP short-circuit if non-ifs lsps are detected" is the consumer.
- **Bun disposition**: should-port. Target: engine

### [SOCK-04] AcceptEx/ConnectEx must be fetched per socket via WSAIoctl, not GetProcAddress
- **What Windows does**: `AcceptEx`/`ConnectEx` exported from mswsock.dll are generic forwarders; the real implementations are *provider-specific*. `WSAIoctl(SIO_GET_EXTENSION_FUNCTION_POINTER, WSAID_ACCEPTEX/CONNECTEX)` on a concrete socket returns the function for *that socket's provider* (matters when LSPs or non-MSAFD providers are involved) and skips the forwarder overhead.
- **How libuv handles it**: `uv__get_acceptex_function` / `uv__get_connectex_function` (winsock.c:41-74) fetch per socket; the result is cached **per handle** (`handle->tcp.serv.func_acceptex`, `handle->tcp.conn.func_connectex`, tcp.c:641-645, 850-854), never globally. Lookup failure is reported as `WSAEAFNOSUPPORT`.
- **History**: present since the original port; the per-handle (not global) cache is the deliberate part.
- **Bun disposition**: must-port (if Bun ever calls AcceptEx/ConnectEx directly, e.g. for IPC socketpair or net compat). Target: Bun winsock util module. Cache per socket/provider, not in a process global initialized from a dummy socket.

### [SOCK-05] NTSTATUS→winsock error mapping table (overlapped sockets complete with NTSTATUS)
- **What Windows does**: For overlapped socket I/O completing via IOCP, `OVERLAPPED.Internal` holds a raw **NTSTATUS**, not a WSA error. There is no public API to convert NTSTATUS to a winsock error; `RtlNtStatusToDosError` gives win32 errors that don't match what `WSAGetLastError` would have returned (e.g. you'd get ERROR_CONNECTION_RESET instead of WSAECONNRESET).
- **How libuv handles it**: A hand-built ~50-case switch `uv__ntstatus_to_winsock_error` (winsock.c:139-253): STATUS_REMOTE_DISCONNECT/CONNECTION_RESET/…→WSAECONNRESET, STATUS_LOCAL_DISCONNECT/CONNECTION_ABORTED→WSAECONNABORTED, STATUS_CONNECTION_REFUSED→WSAECONNREFUSED, STATUS_TOO_MANY_ADDRESSES/SHARING_VIOLATION/ADDRESS_ALREADY_EXISTS→WSAEADDRINUSE, STATUS_CONFLICTING_ADDRESSES/INVALID_ADDRESS→WSAEADDRNOTAVAIL, etc. Fallback: if the status is an ntstatus-wrapped win32 error (`FACILITY_NTWIN32` and severity bits) extract `status & 0xffff`, else WSAEINVAL. Requests store errors as ntstatus (`SET_REQ_ERROR` = `NTSTATUS_FROM_WIN32`, req-inl.h:30-53) so one representation flows everywhere; `GET_REQ_SOCK_ERROR` converts back through this table.
- **History**: 6622c35b added the table; 0ded5d29 fixed "improper treatment of real ntstatus codes as mapped win32 errors" (the FACILITY_NTWIN32 check order); 261d792a added STATUS_HOPLIMIT_EXCEEDED→WSAECONNRESET (Linux TTL-expired parity); f326820f fixed STATUS_TOO_MANY_ADDRESSES→WSAEADDRINUSE and STATUS_CONFLICTING_ADDRESSES→WSAEADDRNOTAVAIL.
- **Bun disposition**: must-port. Target: bun sys error layer (Windows) / AFD poll backend — anything reading IOSB/OVERLAPPED status from AFD directly needs exactly this table. Port the table verbatim with the FACILITY_NTWIN32 fallback.

### [SOCK-06] SetFileCompletionNotificationModes is broken for UDP datagram sockets — bypass winsock via NtDeviceIoControlFile
- **What Windows does**: With `FILE_SKIP_COMPLETION_PORT_ON_SUCCESS` enabled on a datagram socket, `WSARecv`/`WSARecvFrom` "does not reliably indicate whether we can expect a completion packet to be posted when the receive buffer is smaller than the received datagram" (all known Windows versions). You can either lose completions or double-process them.
- **How libuv handles it**: `uv__wsarecv_workaround` / `uv__wsarecvfrom_workaround` (winsock.c:256-460) reimplement WSARecv(From) by calling `pNtDeviceIoControlFile` directly with `IOCTL_AFD_RECEIVE`/`IOCTL_AFD_RECEIVE_DATAGRAM`, building `AFD_RECV_INFO` with `AFD_OVERLAPPED` + TDI flags, and translating NTSTATUS themselves (STATUS_BUFFER_OVERFLOW→WSAEMSGSIZE, STATUS_RECEIVE_EXPEDITED→MSG_OOB, etc.). Works only on the stock MSAFD driver — so it is only installed when `ProtocolChain.ChainLen == 1` (udp.c:93-104). UDP handles carry `func_wsarecv`/`func_wsarecvfrom` pointers defaulting to the real WSARecv(From) (udp.c:126-127).
- **History**: 51e9dbc2 "Work around windows udp bug, allow zero reads" — the comment block at winsock.c:256-271 documents why ("massive performance increase" from skipping IOCP on sync completion).
- **Bun disposition**: should-port (knowledge), likely skip (code). Target: AFD poll backend / node:dgram. Bun's AFD-poll design does readiness polling + nonblocking recv, which sidesteps this entirely — that is the right call; do NOT enable FILE_SKIP_COMPLETION_PORT_ON_SUCCESS on datagram sockets unless you replicate this AFD bypass. Record as a hard constraint.

### [SOCK-07] Tagging OVERLAPPED.hEvent's low bit suppresses IOCP completion delivery
- **What Windows does**: Documented (GetQueuedCompletionStatus remarks): if the low-order bit of `OVERLAPPED.hEvent` is set, the completion is NOT queued to the completion port even though the handle is associated. The event itself still gets signaled.
- **How libuv handles it**: Used in three places: the EMULATE_IOCP paths set `overlapped.hEvent = event | 1` so completions are delivered via the event only (tcp.c:492-495, 557-560, 954-960); `uv__msafd_poll` honors a caller-tagged event by stripping the bit and passing NULL apc_context (winsock.c:477-483); the wsarecv workarounds pass `apc_context = NULL` when the event is tagged (winsock.c:299-303) — for raw NtDeviceIoControlFile the equivalent of "don't post to IOCP" is a NULL ApcContext.
- **History**: introduced with IPC/EMULATE_IOCP (81c4043c) and uv_msafd_poll (19aca7a7).
- **Bun disposition**: must-port (knowledge). Target: AFD poll backend. When issuing IOCTL_AFD_POLL via NtDeviceIoControlFile, ApcContext is what keys IOCP delivery: pass the OVERLAPPED/ctx pointer to get an IOCP completion, NULL to suppress it. Get this wrong and you get ghost completions for synchronously-satisfied polls.

### [SOCK-08] IOCTL_AFD_POLL: the kernel always writes the result somewhere — never give it stack memory you abandon
- **What Windows does**: `IOCTL_AFD_POLL` (the readiness-poll ioctl on \Device\Afd) completes by writing an AFD_POLL_INFO output buffer at completion time, possibly long after submission. There is no clean cancel: you cancel an outstanding poll by submitting another poll (or CancelIoEx); the old request still completes and still writes its output buffer.
- **How libuv handles it**: `uv__msafd_poll` (winsock.c:463-547) wraps NtDeviceIoControlFile(IOCTL_AFD_POLL) supporting both overlapped and blocking (event + WaitForSingleObject) modes. poll.c keeps the output buffers inside the handle and, for the "canceling" poll request it forgets about, points the output at static scratch space.
- **History**: 19aca7a7 added uv_msafd_poll; 48d39345 "win: avoid stack corruption when closing a poll handle" (PR #49) — the canceling AFD_POLL request's result was being written to a dead stack frame, corrupting the stack "sometimes".
- **Bun disposition**: must-port. Target: AFD poll backend. Cross-ref: POLL. Every AFD_POLL_INFO output buffer must live until the request provably completed (heap/handle-owned or static scratch), including for cancel-via-repoll requests.

### [SOCK-09] AFD magic constants come from the DDK, not any SDK header
- **What Windows does**: \Device\Afd ioctls and structures (AFD_POLL_INFO, AFD_RECV_INFO, TDI flags) are undocumented. The control codes are built as `FSCTL_AFD_BASE(=FILE_DEVICE_NETWORK 0x12) << 12 | operation << 2 | method`, with AFD_RECEIVE=5, AFD_RECEIVE_DATAGRAM=6, AFD_POLL=9; RECEIVE uses METHOD_NEITHER, POLL uses METHOD_BUFFERED (winsock.h:159-175). Event bits: RECEIVE=1<<0, SEND=1<<2, DISCONNECT=1<<3 (peer FIN), ABORT=1<<4 (RST), LOCAL_CLOSE=1<<5, CONNECT=1<<6, ACCEPT=1<<7, CONNECT_FAIL=1<<8 (winsock.h:116-140).
- **How libuv handles it**: Hand-defined in winsock.h with the comment "Having these definitions allows us to bypass winsock and make an AFD kernel call directly" (winsock.h:105-110).
- **History**: code comment only; constants stable since NT4 and identical in wepoll/mio.
- **Bun disposition**: must-port. Target: AFD poll backend. Keep the bit meanings documented — especially that POLL_DISCONNECT(graceful FIN) vs POLL_ABORT(RST) vs POLL_CONNECT_FAIL must all be mapped (missing CONNECT_FAIL = hung connects; wepoll maps ABORT to both HUP and ERR).

### [SOCK-10] connect() to 0.0.0.0/:: must be rewritten to localhost
- **What Windows does**: On Linux, connecting to the wildcard address 0.0.0.0/:: implicitly means localhost. Windows `ConnectEx` to 0.0.0.0 fails (WSAEADDRNOTAVAIL-ish) instead.
- **How libuv handles it**: `uv__convert_to_localhost_if_unspecified` (winsock.c:549-577) copies the sockaddr and rewrites INADDR_ANY→INADDR_LOOPBACK and in6addr_any→in6addr_loopback. Applied in `uv__tcp_try_connect` (tcp.c:828) and `uv__udp_try_send` (udp.c:1129-1134).
- **History**: 2b32e77b "win: map 0.0.0.0 and :: addresses to localhost" (PR #1515), explicitly for Linux parity. Node relies on it (`net.connect({port})` resolving to 0.0.0.0 paths).
- **Bun disposition**: must-port. Target: node:net / node:dgram Windows compat layer (uSockets connect path may already need this — verify). Without it, `connect(80, "0.0.0.0")` behaves differently on Windows than Linux.

### [SOCK-11] Create sockets with WSA_FLAG_NO_HANDLE_INHERIT (atomic), not SetHandleInformation after the fact
- **What Windows does**: Handles are inheritable by default for `socket()`. Clearing inheritance afterwards with `SetHandleInformation` leaves a race window: a concurrent `CreateProcess(bInheritHandles=TRUE)` on another thread can leak the socket into a child (which then e.g. keeps ports alive after you close them). `WSA_FLAG_NO_HANDLE_INHERIT` (Win7 SP1+) makes creation atomic.
- **How libuv handles it**: Every `WSASocketW` call in tcp.c/udp.c/winsock.c/pipe.c passes `WSA_FLAG_NO_HANDLE_INHERIT` (tcp.c:249, 377, 481, 1339-1344, 1637-1646; udp.c:141, 211; winsock.c:105, 122); the old `SetHandleInformation(HANDLE_FLAG_INHERIT, 0)` calls were deleted.
- **History**: d19855c7 "win: use WSA_FLAG_NO_HANDLE_INHERIT in all WSASocketW" (#5097, follow-up to #4810). Prior art: 64f5c93f "win: set accepted TCP sockets as non-inheritable" — that line had been accidentally dropped in a refactor (2dddd565) and caused an "obscure failure" in node (nodejs/node#2310): accepted sockets leaked into spawned children.
- **Bun disposition**: must-port. Target: all Bun Windows socket creation (uSockets glue, IPC socketpair, AFD poll peer sockets). Note accepted sockets inherit nothing automatically from the listener: every AcceptEx pre-created socket needs the flag too.

### [SOCK-12] Sockets are simultaneously OVERLAPPED and FIONBIO-nonblocking
- **What Windows does**: Overlapped and nonblocking are independent socket properties. Overlapped WSARecv/WSASend with an OVERLAPPED ptr never returns EWOULDBLOCK; plain (NULL overlapped) calls on the same socket obey FIONBIO.
- **How libuv handles it**: `uv__tcp_set_socket`/`uv__udp_set_socket` set `ioctlsocket(FIONBIO, 1)` on every socket (tcp.c:163-166, udp.c:67-70) even though I/O is IOCP-based — because after a zero-read completion libuv drains with *synchronous nonblocking* WSARecv/WSARecvFrom calls (tcp.c:1102-1108, udp.c:467-475) and relies on WSAEWOULDBLOCK to stop.
- **History**: original design; the mixed overlapped+nonblocking pattern is the foundation of the zero-read architecture (SOCK-36).
- **Bun disposition**: must-port. Target: AFD poll backend / any readiness-based Windows socket I/O — readiness polling + nonblocking syscalls requires FIONBIO; uSockets already does this, but imported/IPC-transferred sockets must have FIONBIO (re)applied on import since the mode does not transfer guarantees.

### [SOCK-13] A socket can be associated with exactly one IOCP, forever — emulate IOCP for foreign sockets
- **What Windows does**: `CreateIoCompletionPort(sock, iocp, ...)` fails (ERROR_INVALID_PARAMETER) if the handle is already associated with another completion port; there is no disassociate. Sockets duplicated from another process may arrive pre-associated.
- **How libuv handles it**: In `uv__tcp_set_socket`, association failure is fatal for libuv-created sockets but tolerated for `imported` ones: the handle gets `UV_HANDLE_EMULATE_IOCP` (tcp.c:168-179). Emulation = per-request event handle with low bit tagged into `overlapped.hEvent` + `RegisterWaitForSingleObject(..., WT_EXECUTEINWAITTHREAD)` whose callback `post_completion` re-posts the completion (with `overlapped.InternalHigh` as byte count) onto the loop's IOCP via PostQueuedCompletionStatus (tcp.c:425-460, 492-495, 515-522, 580-587, 954-960, 985-991). Endgame must UnregisterWait + CloseHandle every event (tcp.c:311-340).
- **History**: 81c4043c "ipc on windows" introduced it. UDP never got emulation — `uv__udp_set_socket` just fails (udp.c:74-79).
- **Bun disposition**: should-port (decide deliberately). Target: IPC socket transfer. Options: (a) port the event-wait emulation, (b) reject pre-associated sockets with a clear error. For Bun's own child-process IPC protocol, the exporter can guarantee the socket was never associated, making (b) viable — but `uv_tcp_open`-style adoption of arbitrary user FDs (node:net `new Socket({fd})`) needs (a) or a documented limitation.

### [SOCK-14] Skip-completion-port-on-success is unsafe when a non-IFS LSP is stacked
- **What Windows does**: `SetFileCompletionNotificationModes(FILE_SKIP_COMPLETION_PORT_ON_SUCCESS)` has a known bug with non-IFS LSPs (Microsoft KB2568167): the LSP returns success synchronously but a completion may never be posted (or is posted through the LSP's internal machinery) — I/O silently hangs.
- **How libuv handles it**: TCP enables SFCNM (`FILE_SKIP_SET_EVENT_ON_HANDLE | FILE_SKIP_COMPLETION_PORT_ON_SUCCESS`) only when `!non_ifs_lsp` for the socket's family (tcp.c:181-193), setting `UV_HANDLE_SYNC_BYPASS_IOCP`. The `UV_SUCCEEDED_WITHOUT_IOCP(result)` macro (req-inl.h:69-73) then routes synchronous completions through the loop's pending-req queue instead of waiting for an IOCP packet that will never come.
- **History**: c0e70448 "windows: avoid IOCP short-circuit if non-ifs lsps are detected".
- **Bun disposition**: should-port. Target: AFD poll backend / named pipes. If Bun sets SFCNM on sockets (perf win: saves one IOCP round trip per sync op), it MUST gate on the LSP probe (SOCK-03). FILE_SKIP_SET_EVENT_ON_HANDLE is always safe and a free perf win.

### [SOCK-15] SFCNM and IOCP-emulation are mutually exclusive (event still fires)
- **What Windows does**: FILE_SKIP_COMPLETION_PORT_ON_SUCCESS suppresses the IOCP packet on synchronous success, but does NOT stop `OVERLAPPED.hEvent` from being signaled.
- **How libuv handles it**: the SFCNM enable is additionally gated on `!(handle->flags & UV_HANDLE_EMULATE_IOCP)` (tcp.c:187): with emulation, completions are delivered by the event wait, so a synchronously-completed op would be processed twice (once inline, once from the event callback).
- **History**: 5462dab8 "win/tcp: don't enable iocp sync bypass when iocp emulation is used" — fixed joyent/node#4959.
- **Bun disposition**: must-port (if either mechanism is ported). Target: IPC socket transfer. Generic lesson: for every "deliver completion by X" mode, audit which OTHER delivery channels still fire.

### [SOCK-16] UDP: enable the SFCNM workaround only on a clean protocol chain; tolerate ERROR_INVALID_FUNCTION
- **What Windows does**: (a) the UDP SFCNM bug (SOCK-06) is only worked around safely on stock MSAFD; (b) some environments (notably Wine, and reportedly some providers) don't implement SetFileCompletionNotificationModes at all and fail it with ERROR_INVALID_FUNCTION.
- **How libuv handles it**: `uv__udp_set_socket` checks `SO_PROTOCOL_INFOW.ProtocolChain.ChainLen == 1` (base provider, no LSPs) before attempting SFCNM; on success installs the AFD-bypass recv functions; if SFCNM fails with ERROR_INVALID_FUNCTION it silently falls back to normal IOCP completions, any other error is fatal (udp.c:81-104).
- **History**: ChainLen gate from 51e9dbc2; ERROR_INVALID_FUNCTION tolerance from 0303197a "win: unify uv_{tcp,udp}_set_socket. Fixes #205" (Wine compatibility).
- **Bun disposition**: should-port. Target: node:dgram / AFD poll backend. Wine runs Bun; never treat ERROR_INVALID_FUNCTION from SFCNM as fatal — degrade to the slower path.

### [SOCK-17] TCP_NODELAY/keepalive set before a socket exists must be stored and replayed — and libuv replays keepalive with the WRONG value
- **What Windows does**: nothing special — this is API-design fallout from lazy socket creation (AF_UNSPEC init defers WSASocketW until bind/connect).
- **How libuv handles it**: `uv_tcp_nodelay`/`uv_tcp_keepalive` set flags `UV_HANDLE_TCP_NODELAY`/`UV_HANDLE_TCP_KEEPALIVE` even when `socket == INVALID_SOCKET` (tcp.c:1369-1414); `uv__tcp_set_socket` replays them at socket creation (tcp.c:195-206). BUG/quirk: the replay hardcodes `uv__tcp_keepalive(handle, socket, 1, 60, 1, 10)` — the user's delay is NOT stored ("TODO: Use stored delay.", tcp.c:201-203). `uv_tcp_keepalive(h, 1, 300)` before bind silently becomes 60s idle.
- **History**: code comment only; TODO present for a decade+.
- **Bun disposition**: must-port (the storage), must-fix (store the actual values, don't copy the bug). Target: node:net compat. Also note the accepted-socket path runs the same replay, so server-side keepalive config must flow through handle flags.

### [SOCK-18] Version-probe via RtlGetVersion (ntdll), never GetVersionExW — and zero the struct first
- **What Windows does**: `GetVersionExW` lies (reports 6.2) unless the exe has a compatibility manifest. `RtlGetVersion` from ntdll always tells the truth. Separately, `RtlGetVersion` does not necessarily write all of OSVERSIONINFOW; reading uninitialized `szCSDVersion` after the call is UB.
- **How libuv handles it**: `uv__windows10_version1709` (tcp.c:55-69) uses dynamically-loaded `pRtlGetVersion`, sets `dwOSVersionInfoSize`, and explicitly initializes `os_info.szCSDVersion[0] = L'\0'` before the call.
- **History**: aabb7651 "win: properly initialize OSVERSIONINFOW" (#5107, fixes #5106) — uninitialized struct caused **random /GS stack-cookie crashes (__report_gsfailure) in the node test suite** inside uv__tcp_keepalive. The probe itself replaced manifest-dependent checks when XP support was dropped (a7b16bfb).
- **Bun disposition**: must-port (the lesson). Target: bun_core Windows version helpers (cross-ref: LOOP). Bun's 1809+ baseline makes the *1709 probe* itself unnecessary (always true) — but any future version probe must use RtlGetVersion with a fully-initialized struct.

### [SOCK-19] TCP keepalive: seconds-based setsockopt on 1709+, SIO_KEEPALIVE_VALS (milliseconds!) before; reject zero values
- **What Windows does**: Before Win10 1709, per-socket keepalive is only configurable via `WSAIoctl(SIO_KEEPALIVE_VALS)` taking **milliseconds**, and probe count is fixed by the OS (10 on Vista+, unchangeable). 1709+ supports `setsockopt(TCP_KEEPIDLE/TCP_KEEPINTVL/TCP_KEEPCNT)` in **seconds** (POSIX-style).
- **How libuv handles it**: `uv__tcp_keepalive` (tcp.c:72-148): sets `SO_KEEPALIVE` on/off first; if on, requires idle/intvl/cnt >= 1 (UV_EINVAL); on 1709+ sets the three options in seconds; otherwise SIO_KEEPALIVE_VALS with `idle*1000`/`intvl*1000` and cnt silently ignored. Ordering quirk: SO_KEEPALIVE is enabled *before* validation, so a zero idle leaves keepalive ON with OS defaults and returns EINVAL.
- **History**: 3a9a6e3e added keepalive_ex (intvl/cnt); 6adeeace "error on zero delay tcp keepalive" (#3487 — Windows interprets 0 idle bizarrely / SIO ioctl rejects it inconsistently); default mapping `uv_tcp_keepalive(on, idle)` → intvl=1, cnt=10 (tcp.c:1388-1390) chosen to mimic the old SIO behavior.
- **Bun disposition**: must-port (1709+ path only). Target: node:net compat (`socket.setKeepAlive`). Skip the SIO_KEEPALIVE_VALS fallback (baseline 1809+). Validate values BEFORE touching the socket to avoid the half-applied state. Remember: Windows wants seconds here, same as Linux — but bun code copying older recipes may find ms-based SIO snippets.

### [SOCK-20] Never set SO_REUSEADDR on TCP on Windows; don't use SO_EXCLUSIVEADDRUSE either
- **What Windows does**: Windows SO_REUSEADDR is NOT BSD SO_REUSEADDR: it allows binding to a port that is **actively in use** by another socket (port hijacking), not just TIME_WAIT reuse. SO_EXCLUSIVEADDRUSE prevents hijacking but also rejects binds against TIME_WAIT sockets. Crucially, Windows **default** bind semantics already approximate BSD-with-SO_REUSEADDR (TIME_WAIT rebind generally succeeds).
- **How libuv handles it**: `uv__tcp_try_bind` sets neither option, with a long comment citing the rationale (tcp.c:346-356). UV_TCP_REUSEPORT → ERROR_NOT_SUPPORTED (tcp.c:364-368).
- **History**: 9e921ed1 "doc: clarify why we don't use SO_REUSEADDR for TCP on Windows"; issue #1360 (java/other-app port stolen by libuv server when SO_REUSEADDR was set).
- **Bun disposition**: must-port. Target: node:net listen path / uSockets Windows bind glue (verify uSockets does not set SO_REUSEADDR on Windows — if it does, that is a security bug: any local process can steal Bun's listening port). Node's `reuseAddr`-equivalent semantics on Windows = do nothing.

### [SOCK-21] There is no SO_REUSEPORT on Windows — fail loudly, don't fake it
- **What Windows does**: No load-balancing port sharing exists. SO_REUSEADDR-based "sharing" gives undefined delivery, not round-robin.
- **How libuv handles it**: TCP: `UV_TCP_REUSEPORT` → ERROR_NOT_SUPPORTED (tcp.c:364-368). UDP: `UV_UDP_REUSEPORT` → UV_ENOTSUP at bind (udp.c:199-203) and in uv_udp_open_ex (udp.c:934-938).
- **History**: d2d92b74/ba24986f added SO_REUSEPORT on unix and the explicit Windows rejections at the same time — deliberate asymmetry.
- **Bun disposition**: must-port. Target: node:net/node:dgram option validation. `reusePort: true` on Windows must error (Node 22 does the same), never silently downgrade to SO_REUSEADDR.

### [SOCK-22] WSAEADDRINUSE is raised at bind() on Windows but at listen() on Unix — defer it (delayed_error)
- **What Windows does**: Conflicting-address errors surface from `bind` itself; on Unix they surface at `listen`/`connect`. Code written against Unix semantics (node cluster) breaks if bind errors are synchronous.
- **How libuv handles it**: `uv__tcp_try_bind` stores **only WSAEADDRINUSE** in `handle->delayed_error` and reports success; all other bind errors return immediately (tcp.c:407-421). The delayed error is then surfaced: at listen (tcp.c:626-628, re-checked after implicit bind at 637-638), at connect — where the connect req is completed through the pending-req queue *without ever issuing ConnectEx* so the error arrives on the next tick like Unix (tcp.c:832-833, 846-847, 882-888, 1265-1271), and from getsockname/getpeername (core.c:848-849: delayed_error short-circuits with that error). It is also propagated across process boundaries in the IPC xfer info (SOCK-46).
- **History**: d1e6be14 "tcp: reveal bind-time errors before listen"; 1ece8fb8 "return bind error immediately when implicitly binding" (implicit binds can't be deferred meaningfully); 6d3a051e "relay TCP bind errors via ipc" (joyent/node#7691 — clustered EADDRINUSE was lost).
- **Bun disposition**: must-port. Target: node:net compat layer. Node-on-Windows users observe EADDRINUSE on `listen` callback / `connect` error event, not as a sync throw from bind. The "complete the connect request without issuing it" trick is the cleanest shape.

### [SOCK-23] IPv6 dual-stack: V6ONLY is ON by default on Windows; setsockopt may fail and must be ignored
- **What Windows does**: Windows defaults `IPV6_V6ONLY = 1` (no dual-stack) — opposite of Linux's default (usually 0). Setting it can fail when no IPv4 stack is present.
- **How libuv handles it**: TCP: sets `IPV6_V6ONLY` to the requested flag value on AF_INET6 binds, **silently ignoring errors** ("TODO: how to handle errors? … For now we're silently ignoring", tcp.c:390-405) — i.e. TCP default stays Windows-native V6ONLY unless UV_TCP_IPV6ONLY semantics requested. UDP: when the user did NOT pass UV_UDP_IPV6ONLY, libuv **explicitly turns V6ONLY off** to give Linux-style dual-stack by default ("On windows IPV6ONLY is on by default. If the user doesn't specify it libuv turns it off.", udp.c:240-252), errors ignored.
- **History**: 8f15aae5 "tcp: uv_tcp_dualstack()" era; comments unchanged since the XP days.
- **Bun disposition**: must-port. Target: node:net/node:dgram bind paths. Node's `ipv6Only: false` default requires actively clearing V6ONLY on Windows; ignore the setsockopt error (v4-less hosts). Note the TCP/UDP asymmetry in libuv and that Node's net layer passes the flag explicitly for TCP.

### [SOCK-24] Loopback connects: kill SYN retransmission so connection-refused is instant (SIO_TCP_INITIAL_RTO)
- **What Windows does**: A TCP connect to a closed port **on loopback** still does the full SYN-retransmit dance: ~2 seconds before failure (vs instant ECONNREFUSED on Unix).
- **How libuv handles it**: Before ConnectEx, if target is loopback (127/8 first byte, or ::1 word-compare — tcp.c:794-812) and OS >= 1709, issue `WSAIoctl(SIO_TCP_INITIAL_RTO)` with `Rtt = MaxSynRetransmissions = TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS ((UCHAR)-2)` (tcp.c:856-873; constants self-defined in winapi.h:4783-4793 because old SDKs lack them). Result deliberately ignored (best effort).
- **History**: 99e88edf "tcp: fail instantly if local port is unbound" (PR #2896). `(UCHAR)-2` is only honored on 1709+; -1 (no retrans value) differs — magic constant from Windows SDK ws2ipdef.h.
- **Bun disposition**: must-port. Target: uSockets Windows connect path / node:net. This is a big DX win (dev servers probing ports). Safe on 1809+ baseline; keep best-effort semantics.

### [SOCK-25] ConnectEx requires an already-bound socket — implicit wildcard bind first
- **What Windows does**: Unlike `connect()`, `ConnectEx` fails with WSAEINVAL on an unbound socket; you must bind (wildcard is fine) first.
- **How libuv handles it**: `uv__tcp_try_connect` binds to `0.0.0.0:0` or `[::]:0` (chosen by addrlen) when UV_HANDLE_BOUND is unset, before fetching ConnectEx (tcp.c:835-848). The same pre-built wildcard sockaddrs from winsock init are reused. `abort()` if addrlen matches neither family size.
- **History**: original port behavior; ties into SOCK-22's delayed-error re-check after the implicit bind.
- **Bun disposition**: must-port (knowledge). Target: anywhere Bun calls ConnectEx directly (IPC socketpair does connect(), uSockets handles its own). A from-scratch ConnectEx user WILL hit WSAEINVAL without this.

### [SOCK-26] AcceptEx: pre-create the accept socket; keep 32 outstanding; cluster mode needs exactly 1
- **What Windows does**: AcceptEx requires the caller to pre-create the accept socket (same family) and pass an output buffer for local+remote addresses. Multiple simultaneous AcceptEx calls is how you get accept throughput on IOCP. But with a WSADuplicateSocketW-shared listening socket across processes, the kernel hands connections to whichever process has a pending AcceptEx — 32 pending in each process destroys cluster load-balancing fairness.
- **How libuv handles it**: `uv_simultaneous_server_accepts = 32` accept reqs allocated at listen (tcp.c:35, 660-697); each `uv__tcp_queue_accept` creates the socket, then AcceptEx with 0 receive length (tcp.c:463-536). `uv_tcp_simultaneous_accepts(0)` switches to single-accept mode; the transition is a careful state machine (UV_HANDLE_TCP_SINGLE_ACCEPT + UV_HANDLE_TCP_ACCEPT_STATE_CHANGING + processed_accepts counter, tcp.c:742-763, 1417-1446) that waits until all 32 in-flight accepts are consumed before dropping to 1; switching back from single to many is UV_ENOTSUP.
- **History**: 78f4b120 "knob for tuning number of concurrent accept requests" — added for node cluster on Windows (the `NODE_MANY_ACCEPTS` saga); node sets simultaneous_accepts(0) for shared sockets.
- **Bun disposition**: should-port. Target: IPC socket transfer / node:cluster compat. Bun's cluster story on Windows needs single-accept on shared listeners or accept distribution will be wildly skewed. The 32-deep pipeline itself: only if Bun ever serves accepts via AcceptEx instead of uSockets.

### [SOCK-27] AcceptEx with dwReceiveDataLength=0 — never accept-with-receive
- **What Windows does**: AcceptEx can atomically accept + receive first data, but then the accept does not complete until the client sends data — a slowloris vector and it breaks accept semantics.
- **How libuv handles it**: always passes 0 receive length; buffer is only for the two addresses: `accept_buffer[sizeof(struct sockaddr_storage) * 2 + 32]` (uv/win.h:409), passing `sizeof(sockaddr_storage)` for each address length (AcceptEx requires addrlen >= protocol max + 16; storage=128 covers it) (tcp.c:497-504).
- **History**: code comment only (buffer sizing inherited from MSDN sample conventions).
- **Bun disposition**: must-port (knowledge) if AcceptEx is used. Target: IPC/socketpair helper. The +16-per-address requirement is the classic from-scratch mistake (AcceptEx fails WSAEINVAL or silently truncates).

### [SOCK-28] SO_UPDATE_ACCEPT_CONTEXT / SO_UPDATE_CONNECT_CONTEXT are mandatory after AcceptEx/ConnectEx
- **What Windows does**: Sockets from AcceptEx/ConnectEx are in a half-initialized state: getsockname/getpeername/shutdown/setsockopt fail with WSAENOTCONN until `setsockopt(SO_UPDATE_ACCEPT_CONTEXT, &listen_socket)` (accepted) or `setsockopt(SO_UPDATE_CONNECT_CONTEXT, NULL)` (connected) is applied.
- **How libuv handles it**: accept completion applies SO_UPDATE_ACCEPT_CONTEXT with the listening socket as the option value before exposing the connection (tcp.c:1228-1233); failure → treat as failed accept: close the socket, keep the server alive, requeue (tcp.c:1241-1250). Connect completion applies SO_UPDATE_CONNECT_CONTEXT and only then marks the stream readable/writable (tcp.c:1276-1285). uv_socketpair does the same for its AcceptEx side (tcp.c:1696-1699).
- **History**: original port.
- **Bun disposition**: must-port (knowledge). Target: IPC socketpair / any direct AcceptEx-ConnectEx use. Forgetting SO_UPDATE_*_CONTEXT yields sockets that "work" for I/O but fail shutdown()/getpeername() — extremely confusing in production.

### [SOCK-29] Accept errors: distinguish "server broken" from "this one connection broken"
- **What Windows does**: AcceptEx failure can mean the pre-created accept socket couldn't be made (resource exhaustion — server still fine), the accept op itself failed (often transient), or the listen socket is dead.
- **How libuv handles it**: if `req->accept_socket == INVALID_SOCKET` (socket pre-creation failed) the server **stops listening** and reports the error to connection_cb (tcp.c:1215-1227); if AcceptEx/SO_UPDATE failed but the socket exists, the error is swallowed, the accepted socket closed, and the accept requeued — "the server socket may still be healthy. If the server socket is broken uv_queue_accept will detect it" (tcp.c:1241-1250).
- **History**: code comment only.
- **Bun disposition**: should-port. Target: any AcceptEx-based path. Generic lesson for accept loops: per-connection errors must not kill the listener (this mirrors EMFILE handling on Unix).

### [SOCK-30] Unused accept reqs must still be fully initialized — close/endgame walks all 32
- **What Windows does**: nothing — pure bookkeeping trap.
- **How libuv handles it**: in single-accept mode only `simultaneous_accepts` (=1) reqs are queued, but endgame/close iterate over all `uv_simultaneous_server_accepts` (=32); the unqueued ones are explicitly initialized (accept_socket=INVALID_SOCKET, event_handle=NULL, wait_handle=INVALID_HANDLE_VALUE) so cleanup doesn't act on garbage (tcp.c:686-696, comment at 686-688; endgame at 311-328; close at 1508-1519).
- **History**: 4f913b66 "windows: freeze in uv_tcp_endgame" — uninitialized event_handle of unused accept reqs made endgame close an invalid handle; froze node's test-cluster-disconnect on Windows.
- **Bun disposition**: must-port (pattern). Target: any fixed-size request pool in Bun's Windows loop. Initialize the whole pool, not just the active prefix — or track the initialized count.

### [SOCK-31] Zero-byte overlapped read as readiness probe, then drain with nonblocking reads
- **What Windows does**: An overlapped WSARecv with a zero-length buffer on TCP completes when data arrives without consuming anything — a readiness notification through IOCP. This avoids pinning a real buffer in the kernel per idle connection (with 10k connections × 64KB that's real non-paged pool pressure).
- **How libuv handles it**: `uv__tcp_queue_read` always issues a 0-byte WSARecv (UV_HANDLE_ZERO_READ, tcp.c:539-593); on completion `uv__process_tcp_read_req` drains with synchronous nonblocking WSARecv calls until WSAEWOULDBLOCK (tcp.c:1088-1147). The alternative "preallocate buffer below an active-stream threshold" optimization existed but was disabled (threshold=0) for 11 years because node's slab allocator performed poorly with it, then deleted.
- **History**: 2b4b293e "win,tcp,udp: remove 'active streams' optimization — It has been disabled for 11 years, I guess it should remain that way." The dead non-zero-read branches in the completion handlers (tcp.c:1063-1086) are leftovers from that removal.
- **Bun disposition**: must-port (concept). Target: AFD poll backend. AFD_POLL is the strictly-better modern version of the same idea (readiness without buffer pinning). Keep the drain-loop + WSAEWOULDBLOCK structure. Skip the preallocation threshold machinery — evidence says it's not worth it.

### [SOCK-32] Cap the post-readiness drain loop at 32 iterations — loop starvation is real
- **What Windows does**: nothing — backpressure/event-loop fairness issue. A peer that sends as fast as you can read keeps the nonblocking read loop spinning forever, starving timers and other handles.
- **How libuv handles it**: both TCP (`count = 32`, tcp.c:1089-1090) and UDP (`count = 32`, udp.c:450-453, loop condition 504-508) cap reads per completion, then requeue the zero-read and return to the loop. UDP's loop also re-checks `UV_HANDLE_READING && !READ_PENDING` each iteration because recv_cb may pause/close the handle.
- **History**: TCP: 8a647d43 "win, tcp: avoid starving the loop" (issue #2027 — node http server starved by one fast client; mirrors the unix 32×64KB budget from 738b31eb). UDP: dff3f8cc "win: optimize udp receive performance" (issue #3704 — previously requeued an overlapped recv per datagram; 32-in-a-row nonblocking reads was a large perf win AND the fairness cap).
- **Bun disposition**: must-port. Target: AFD poll backend read paths / node:dgram. Whatever Bun's drain loop is, it needs a deterministic per-wakeup budget; 32 is the battle-tested number for parity with both libuv platforms.

### [SOCK-33] Clamp single I/O calls to UV__IO_MAX_BYTES (0x7ffff000)
- **What Windows does**: DWORD byte counts + APIs that misbehave above 2^31; giant single WSARecv/WSASend buffer lengths historically "failed in bizarre ways".
- **How libuv handles it**: alloc_cb-provided buffers are clamped: `if (buf.len > UV__IO_MAX_BYTES) buf.len = UV__IO_MAX_BYTES` (tcp.c:1098-1099; same constant used in stream/pipe/fs). 0x7ffff000 is the Linux kernel's MAX_RW_COUNT — deliberately shared across platforms.
- **History**: fa0ac9ec "io: make libuv 64-bit safe (#5076)" — decade-old class of bugs; julia patched downstream for 10+ years.
- **Bun disposition**: must-port. Target: all Bun Windows read/write syscall wrappers (cross-ref: FS). One clamp constant, applied at the syscall boundary.

### [SOCK-34] Remap WSAECONNABORTED→ECONNRESET on reads, ECONNABORTED→ECANCELED on writes (Unix parity)
- **What Windows does**: Windows reports many peer-disconnect/local-abort situations as WSAECONNABORTED where Unix produces ECONNRESET (reads) — and aborted overlapped writes complete with WSAECONNABORTED/STATUS aborts where Unix write paths see the op canceled.
- **How libuv handles it**: read paths: `if (err == WSAECONNABORTED) err = WSAECONNRESET` with "consistent with Unix" comments in BOTH the failed-completion branch and the nonblocking-drain branch (tcp.c:1051-1055, 1134-1138). Write completion: `if (err == UV_ECONNABORTED) err = UV_ECANCELED` (tcp.c:1185-1188).
- **History**: 431b535a "windows: use UV_ECANCELED for aborted TCP writes — For consistency with Unix"; read remap from the early port.
- **Bun disposition**: must-port. Target: node:net error mapping (uSockets glue too — verify what uSockets surfaces for aborts). Node user code matches on `code === 'ECONNRESET'`; raw WSAECONNABORTED leaks Windows-isms into JS.

### [SOCK-35] WSAEWOULDBLOCK after a readiness signal is normal — report a 0-byte read, don't error
- **What Windows does**: The zero-read completes (data was there), but by the time the nonblocking read runs, the data may be gone (e.g. consumed by... nothing else here — actually: spurious/raced readiness). WSAEWOULDBLOCK then comes out of the drain read.
- **How libuv handles it**: `err == WSAEWOULDBLOCK` → `read_cb(handle, 0 bytes)` ("Read buffer was completely empty, report a 0-byte read", tcp.c:1124-1128); UDP equivalent reports 0/NULL addr (udp.c:489-491). Then the zero-read is requeued.
- **History**: original design; required because alloc_cb already produced a buffer that must be returned.
- **Bun disposition**: must-port (semantics). Target: AFD poll backend. AFD_POLL has the same property (level-triggered-ish; events can be stale after local consumption). The drain must treat EWOULDBLOCK as "done", never as an error.

### [SOCK-36] uv_read_stop doesn't cancel the in-flight zero-read; restart must not double-queue
- **What Windows does**: An overlapped op can't be "un-submitted"; CancelIoEx is async and racy for this purpose.
- **How libuv handles it**: read_stop just clears UV_HANDLE_READING; the zero-read stays pending. `uv__tcp_read_start` re-arms only `if (!(handle->flags & UV_HANDLE_READ_PENDING))` ("If reading was stopped and then started again, there could still be a read request pending", tcp.c:778-789); UDP identical (udp.c:332-335). The completion of a stale zero-read while !READING is dropped without invoking callbacks (tcp.c:1040-1061 guards on READING || !ZERO_READ).
- **History**: f779fd4f "win,tcp: avoid reinserting a pending request" (#2687/#2688) — when WSARecv failed *synchronously* inside queue_read while the user called uv_read_start from a read callback after an error, the req was inserted into the pending queue twice → loop corruption. The fix: req-pending flag discipline around the insert.
- **Bun disposition**: must-port (pattern). Target: AFD poll backend. Same shape exists with AFD_POLL: pause/resume must track "poll op outstanding" separately from "user wants data", and a completion must be re-validated against current interest. Double-submitting a poll op for the same handle is the analogous corruption.

### [SOCK-37] Write failures are never reported synchronously — always defer to the next tick
- **What Windows does**: WSASend can fail immediately (e.g. ENOBUFS, connection gone). Reporting that synchronously from uv_write re-enters user code at an unexpected time (Unix never does this — it queues).
- **How libuv handles it**: all three WSASend outcomes (sync success / queued / sync failure) take the same path: req counted, registered, and (for sync outcomes) pushed through the loop's pending-req queue so `cb` runs on the next iteration (tcp.c:971-1000 — note the error branch stores the error in the req and still returns 0 from uv__tcp_write). UDP send is the same except hard failures DO return synchronously from uv__udp_send (udp.c:391-394) — asymmetry to be aware of.
- **History**: f880023b "windows: defer reporting TCP write failure until next tick" (issue #339).
- **Bun disposition**: must-port (semantics). Target: node:net write path. JS `socket.write(cb)` error delivery must be async on Windows exactly like Linux; sync callback invocation has broken real node code (state machines re-entered).

### [SOCK-38] uv_try_write must refuse while overlapped writes are pending (ordering), and EMULATE_IOCP can't try_write at all
- **What Windows does**: A synchronous WSASend issued while an overlapped WSASend is still queued can be sent out-of-order ahead of the queued data.
- **How libuv handles it**: `uv__tcp_try_write` returns UV_EAGAIN if `write_reqs_pending > 0` (tcp.c:1006-1013). Additionally stream.c blocks try_write entirely on EMULATE_IOCP handles (uv_try_write returns UV_EAGAIN there) because the sync-send + event-completion bookkeeping doesn't mix.
- **History**: 9b8cef44 "win,tcp: support uv_try_write" (PR #127).
- **Bun disposition**: must-port (rule). Target: node:net `_writev`/cork paths on Windows. Interleaving sync and async sends reorders bytes on the wire — same rule applies to any Bun fast-path send in front of a queued overlapped send.

### [SOCK-39] Shutdown (FIN) may only be dispatched after every queued write completed
- **What Windows does**: `shutdown(SD_SEND)` takes effect immediately; calling it with overlapped WSASends still queued can abort them / send FIN before the data.
- **How libuv handles it**: shutdown reqs are parked until `write_reqs_pending == 0`; `uv__process_tcp_write_req` triggers `uv__process_tcp_shutdown_req` when the last write drains (tcp.c:1192-1202); the shutdown processor asserts write_reqs_pending==0, returns ECANCELED if the handle started closing first, else shutdown(SD_SEND) + UV_HANDLE_SHUT (tcp.c:275-299).
- **History**: ee970e38 "win,shutdown: improve how shutdown is dispatched" (#3649) — split shutdown dispatch out of endgame (it used to be detected inside endgame, racing the close path); 7bccb562 removed the UV_HANDLE_SHUTTING flag in favor of `uv__is_stream_shutting`.
- **Bun disposition**: must-port (semantics). Target: node:net `socket.end()` on Windows (uSockets shutdown sequencing — verify). FIN-before-data is a data-loss bug users see as truncated responses under load.

### [SOCK-40] Closing a socket with ANY outstanding overlapped I/O sends RST — cancel reads/writes first, then wait
- **What Windows does**: `closesocket()` with pending overlapped operations aborts the connection with an RST packet (even with pending *reads*: an unconsumed-data close is treated as abortive). Default closesocket is otherwise a graceful background close.
- **How libuv handles it**: `uv__tcp_close` for connections: stop reading, then `uv__tcp_try_cancel_reqs` issues `CancelIoEx(socket, &read_req.overlapped)` for the pending read and `CancelIo(socket)` for writes (tcp.c:1449-1498); then **delays closesocket until write_reqs_pending == 0** ("If any overlapped req failed to cancel, calling closesocket now would cause Win32 to send an RST packet. Try to avoid that for writes ... There's not much we can do about canceled reads, which also will generate an RST packet.", tcp.c:1531-1540) — the socket is finally closed when the last write completion drains (tcp.c:1193-1197).
- **History**: 99eb736b "win,tcp: make uv_close work more like unix" (#3034, nodejs/node#35904/#35946) — long saga: uv_close on Windows used to RST connections that Unix closed gracefully, breaking HTTP keep-alive teardown. Earlier shape: 6e8eb332.
- **Bun disposition**: must-port. Target: any Bun-owned overlapped socket (IPC transport, adopted fds); uSockets handles its own sockets. Rule: cancel → drain completions → closesocket. Note `CancelIoEx` per-op for reads vs whole-handle `CancelIo` for writes is because write reqs aren't tracked individually (comment at tcp.c:1461-1463).

### [SOCK-41] Cancel based on "op actually outstanding", not "user-level reading" — flag confusion caused phantom RSTs
- **What Windows does**: follows from SOCK-40 — failing to cancel a pending read before closesocket = RST to the peer.
- **How libuv handles it**: `uv__tcp_try_cancel_reqs` checks `UV_HANDLE_READ_PENDING` (a WSARecv is in flight) not `UV_HANDLE_READING` (user wants data); and uv__tcp_close calls `uv_read_stop` BEFORE cancel so flags are consistent (tcp.c:1455-1459, 1502-1506).
- **History**: 69ebb2d7 "win: fix unexpected ECONNRESET error on TCP socket" (#3584): after read_stop, READING was clear but a zero-read was still pending; the old code skipped cancellation → closesocket RST'd the peer "randomly" depending on timing.
- **Bun disposition**: must-port (pattern). Target: AFD poll backend close path. Track "kernel op outstanding" as its own state bit, distinct from user intent; close must consult the former.

### [SOCK-42] With a non-IFS LSP, CancelIo must target the BASE handle (SIO_BASE_HANDLE) — and try both
- **What Windows does**: With non-IFS LSPs the SOCKET you hold is the LSP's pseudo-handle; the kernel op lives on the underlying MSAFD base socket. CancelIo(Ex) on the LSP handle doesn't reach it. `WSAIoctl(SIO_BASE_HANDLE)` unwraps to the base handle.
- **How libuv handles it**: `uv__tcp_try_cancel_reqs` cancels on the user socket first, then if non-IFS LSP detected, fetches SIO_BASE_HANDLE and — only if it differs — cancels again on the base handle (tcp.c:1468-1497). If SIO_BASE_HANDLE itself fails, gives up on cancellation (accepting the RST). poll.c does the unwrap up front at init instead (poll.c:425-440: "Try to obtain a base handle for the socket. This increases the chances that we find an AFD handle and are able to use the fast poll mechanism").
- **History**: 6e8eb332 introduced it ("This will always fail on Windows XP/3k" comment era). Note libuv uses ONLY SIO_BASE_HANDLE; wepoll/uSockets-style backends additionally probe SIO_BSP_HANDLE_SELECT/SIO_BSP_HANDLE_POLL because some LSPs lie about/fail SIO_BASE_HANDLE (cross-ref: POLL — Bun's AFD backend should use the wepoll fallback chain: SIO_BASE_HANDLE, then SIO_BSP_HANDLE_POLL if it returns a different socket, validated against the original).
- **Bun disposition**: should-port. Target: AFD poll backend (mandatory there: AFD_POLL ONLY works on real AFD handles) + any CancelIo path on adopted user sockets. For Bun-created sockets on 1809+ with no LSPs the unwrap is an identity op — cheap insurance.

### [SOCK-43] Shared listen sockets: closesocket doesn't cancel your AcceptEx ops while another process holds the socket
- **What Windows does**: The underlying socket stays alive while any duplicated handle exists in any process. Your closesocket then does NOT abort your pending AcceptEx calls — they keep filling with connections your process will never service (and each holds its pre-created accept socket).
- **How libuv handles it**: server close path explicitly closes every pre-created `accept_socket` ("First close the incoming sockets to cancel the accept operations before we free their resources", tcp.c:1507-1519) — closing the accept-side socket forces each AcceptEx to complete with an error regardless of the listen socket's refcount. Historically it tried CancelIo-on-base-handle first with the accept-socket close as fallback ("not cool because we might inadvertently close a socket that just accepted a new connection, which will cause the connection to be aborted" — old comment).
- **History**: 6e8eb332 "windows: abort accept requests when a shared tcp server is closed" — node cluster: a worker closing its copy of the server leaked accepts forever.
- **Bun disposition**: must-port (if Bun implements shared listeners for cluster). Target: IPC socket transfer / node:cluster. This and SOCK-26 are the two non-obvious halves of Windows socket sharing.

### [SOCK-44] uv_tcp_close_reset = SO_LINGER{on,0} + close; never mix with shutdown
- **What Windows does**: Setting linger {l_onoff=1, l_linger=0} converts closesocket into an abortive RST close. After shutdown(SD_SEND) the socket is mid-graceful-close; layering an RST close on top behaves inconsistently across platforms.
- **How libuv handles it**: `uv_tcp_close_reset` (tcp.c:596-608): EINVAL if a shutdown is in progress (`uv__is_stream_shutting`), else setsockopt(SO_LINGER {1,0}) then normal uv_close. The cancel-then-wait close dance (SOCK-40) still applies, but now the final closesocket RSTs deliberately.
- **History**: 958e85fb "tcp: add uv_tcp_close_reset" (#1991/#2425) — "Due to some platform inconsistencies, mixing of uv_shutdown and uv_tcp_close_reset calls is not allowed."
- **Bun disposition**: should-port. Target: node:net `socket.resetAndDestroy()` (Node 16.17+ API). The shutdown-mutex rule is the part to copy.

### [SOCK-45] uv_socketpair: loopback AcceptEx emulation, and the kernel sometimes hasn't "noticed" the connect yet
- **What Windows does**: No AF_UNIX socketpair for arbitrary use (AF_UNIX exists 1803+ but libuv predates/avoids it). Emulation: listen on 127.0.0.1:0, connect a client, AcceptEx the server side. Quirk: even though connect() already returned, the immediately-issued AcceptEx can report ERROR_IO_PENDING and `WSAGetOverlappedResult` can return WSA_IO_INCOMPLETE for a few scheduler quanta.
- **How libuv handles it**: `uv_socketpair` (tcp.c:1625-1722): bind/listen(1)/getsockname/connect/AcceptEx; on IO_PENDING it polls `WSAGetOverlappedResult(..., FALSE)` in a loop with `SwitchToThread()` — "Result should complete immediately, since we already called connect, but empirically, we sometimes have to poll the kernel a couple times until it notices that" (tcp.c:1681-1691). Overlapped-ness of each end is selectable (UV_NONBLOCK_PIPE→WSA_FLAG_OVERLAPPED); SO_UPDATE_ACCEPT_CONTEXT applied; no authentication of the connecting peer beyond loopback.
- **History**: 4ddc2927 "stream: add uv_pipe and uv_socketpair to the API".
- **Bun disposition**: should-port. Target: IPC (child stdio sockets) if Bun needs socketpair-on-Windows semantics. SECURITY note a from-scratch impl must add (libuv doesn't): another local process can race-connect to the listening port; verify the accepted peer (getpeername port == client's getsockname port) or use AF_UNIX on 1809+. The SwitchToThread retry loop is empirically required.

### [SOCK-46] WSADuplicateSocketW transfer: parent must listen() BEFORE exporting; delayed bind errors ride along; importer trusts protocol info
- **What Windows does**: `WSADuplicateSocketW(sock, target_pid)` fills a WSAPROTOCOL_INFOW the *target* process turns into a socket via `WSASocketW(FROM_PROTOCOL_INFO×3, &info, ...)`. Socket state (bound/listening/connected) transfers; but a listen() executed *after* duplication in one process does not retroactively make other holders' accepts coherent, and per MSDN the descriptor should stay open in the source until the target has created its socket (the underlying socket dies when the last descriptor closes — if the source closes before import, the info is dead).
- **How libuv handles it**: `uv__tcp_xfer_export` (tcp.c:1295-1327): for server handles not yet listening, calls `listen(SOMAXCONN)` in the EXPORTING process first ("we assume that the other process will be accepting connections on it. Thus, before sharing the socket with another process, we call listen here in the parent process"); failures land in delayed_error which is shipped inside `xfer_info->delayed_error`; marks the local handle UV_HANDLE_SHARED_TCP_SOCKET. The pipe IPC layer keeps the message (and thus the source handle) alive until the write to the target completes. `uv__tcp_xfer_import` (tcp.c:1330-1366) builds the socket FROM_PROTOCOL_INFO, passes `imported=1` (→EMULATE_IOCP fallback, SOCK-13), restores delayed_error, sets BOUND|SHARED (+connection init for connection-type transfers). Import side never re-listens: `uv__tcp_listen` skips the listen syscall when SHARED (tcp.c:647-651 — "If this flag is set, we already made this listen call in xfer").
- **History**: 81c4043c "ipc on windows"; 70925c3b extended to established connections; 6d3a051e for the delayed_error relay (node #7691); 27ba6628 restored compat with the old IPC framing protocol (mixed libuv versions across the pipe — issue #1922, nodejs/node#21671).
- **Bun disposition**: must-port. Target: IPC socket transfer (node:child_process `send(socket)`/cluster). Every clause is load-bearing: listen-before-export, delayed-error relay, skip-listen-on-import, source-stays-open-until-import-acked. Bun's wire format must carry {WSAPROTOCOL_INFOW, delayed_error, server-vs-connection tag}.

### [SOCK-47] UV_HANDLE_SHARED_TCP_SOCKET changes close behavior everywhere
- **What Windows does**: see SOCK-43/46 — a shared socket's kernel object outlives your closesocket.
- **How libuv handles it**: the SHARED flag (set on both exporter and importer) gates: listen-skip (tcp.c:648), the historical cancel-vs-shutdown decisions in close, and signals that pending AcceptEx ops must be aborted via accept-socket closes since closesocket won't do it. Accepted-then-shared connections additionally must not assume exclusive RST/graceful semantics — the peer process may still hold the socket open.
- **History**: 81c4043c + 6e8eb332.
- **Bun disposition**: must-port (flag + close-path audit). Target: IPC socket transfer. Any Bun handle wrapping a possibly-duplicated socket needs a "shared" bit consulted on every lifecycle transition.

### [SOCK-48] uv_tcp_open: detect family via SO_PROTOCOL_INFOW and probe bound/connected state via getsockname/getpeername
- **What Windows does**: An arbitrary user-supplied SOCKET carries no metadata; getsockname fails (WSAEINVAL) on unbound sockets — which doubles as a bind-state probe.
- **How libuv handles it**: `uv_tcp_open` (tcp.c:1547-1587): reads SO_PROTOCOL_INFOW for `iAddressFamily` (don't guess from sockaddr), passes imported=1 to set_socket, then: getsockname succeeds → mark BOUND; then getpeername succeeds → mark connected (connection_init + READABLE|WRITABLE). UDP identical shape (udp.c:908-960 + uv__udp_is_bound).
- **History**: 6827fa34 "win: allow bound/connected socket in uv_tcp_open()" — before this, opening a connected socket left internal flags wrong: uv_listen would try to re-bind, reads/writes errored on "unreadable stream". 03061d54 for UDP.
- **Bun disposition**: must-port. Target: node:net/node:dgram `{fd}` adoption on Windows. Family/bound/connected must be *probed*, never assumed; remember getsockname's failure is the unbound signal (don't translate it into a user-visible error).

### [SOCK-49] UDP zero-read uses MSG_PEEK so the datagram isn't destroyed
- **What Windows does**: Unlike TCP, a 0-byte recv on UDP *consumes* the queued datagram (truncating it to nothing, surfacing WSAEMSGSIZE). MSG_PEEK keeps it queued, so a 0-byte+PEEK overlapped WSARecv is a pure readiness probe.
- **How libuv handles it**: `uv__udp_queue_recv` posts WSARecv(zero buffer, flags=MSG_PEEK) (udp.c:277-289); completion with WSAEMSGSIZE is expected and treated as "data available" ("Not a real error, it just indicates that the received packet was bigger than the receive buffer", udp.c:411-413); then the drain loop does real recvs. The AFD workaround translates MSG_PEEK→TDI_RECEIVE_PEEK (winsock.c:291-293).
- **History**: 51e9dbc2.
- **Bun disposition**: must-port (knowledge). Target: node:dgram on Windows. If Bun ever issues a probing recv on UDP it must PEEK; with AFD_POLL readiness this trap is avoided, but the WSAEMSGSIZE-is-not-an-error mapping is still needed in the real recv path for oversized datagrams (deliver truncated + flag, see SOCK-50).

### [SOCK-50] Truncated UDP datagrams: WSAEMSGSIZE delivers the truncated bytes + a "partial" flag, not an error
- **What Windows does**: WSARecvFrom into a too-small buffer fails with WSAEMSGSIZE but DOES fill the buffer with the truncated prefix and the source address; the rest of the datagram is discarded.
- **How libuv handles it**: drain loop maps WSAEMSGSIZE → `recv_cb(handle, bytes, buf, addr, UV_UDP_PARTIAL)` (udp.c:482-488); overlapped-completion path computes `partial = !REQ_SUCCESS(req)` (udp.c:435-442). Unix instead sets MSG_TRUNC-derived flag — same surface.
- **History**: original UDP port (5c9d749a era).
- **Bun disposition**: must-port. Target: node:dgram. Node delivers the truncated payload silently (no flag in JS API!) — but internal handling must not treat WSAEMSGSIZE as a socket error (a from-scratch impl that errors here kills the socket on the first oversized packet).

### [SOCK-51] UDP WSAECONNRESET/WSAENETRESET on recv = stale ICMP port-unreachable from a previous SEND — swallow it, but you must pop it
- **What Windows does**: Infamous Windows-ism: an ICMP "port unreachable" elicited by a previous sendto is queued ON the socket and delivered as a FAILURE of a subsequent recv (WSAECONNRESET; WSAENETRESET for TTL-expired class). Unix never surfaces this on unconnected sockets. Worse: the error sits in the queue and must be consumed by a real recv — a MSG_PEEK zero-read will see it again forever.
- **How libuv handles it**: completion path: WSAECONNRESET/WSAENETRESET → "A previous sendto operation failed; ignore this error. If zero-reading we need to call WSARecv/WSARecvFrom _without_ the MSG_PEEK flag to clear out the error queue. For nonzero reads, immediately queue a new receive" (udp.c:414-421) — i.e. it deliberately falls through into the drain loop whose plain WSARecvFrom consumes the queued error; in the drain loop those errors are reported as a benign `recv_cb(0 bytes, NULL addr)` and draining continues (udp.c:492-496). libuv does NOT use `SIO_UDP_CONNRESET` to disable the behavior at the source — it filters at recv time (works for adopted sockets too, and avoids the ioctl's spotty support history).
- **History**: ea63f069 "Win: ignore ECONNRESET when receiving udp packets"; the PEEK-can't-clear subtlety is encoded in the comment. No SIO_UDP_CONNRESET commit has ever landed (verified via log -S).
- **Bun disposition**: must-port. Target: node:dgram on Windows. Two valid designs: (a) libuv-style recv-time filtering (must include the "consume without PEEK" rule), or (b) `WSAIoctl(SIO_UDP_CONNRESET, FALSE)` at socket setup like .NET/Go — simpler with an AFD-poll + nonblocking-recv architecture, but must be applied to every socket including adopted ones. Either way: a UDP socket must never die because somebody sent to a closed port.

### [SOCK-52] uv_udp_set_ttl on IPv6 uses IPV6_HOPLIMIT — the WRONG option (latent libuv bug; use IPV6_UNICAST_HOPS)
- **What Windows does**: `IPV6_UNICAST_HOPS` (=4) sets the outgoing hop limit. `IPV6_HOPLIMIT` (=21) is the "report received hop limit in WSARecvMsg ancillary data" boolean.
- **How libuv handles it**: `SOCKOPT_SETTER(ttl, IP_TTL, IPV6_HOPLIMIT, ...)` (udp.c:1005-1008) — so on IPv6 UDP sockets, uv_udp_set_ttl(n) actually enables ancillary hop-limit reporting (any nonzero n = TRUE) instead of setting the TTL. Unix uses IPV6_UNICAST_HOPS (unix/udp.c:1175). Never fixed; no doc caveat.
- **History**: 3eb94e92 "Implement udp multicast methods on windows" introduced it; survived every refactor since (verified: no IPV6_UNICAST_HOPS commit ever touched win/udp.c).
- **Bun disposition**: must-port the CORRECT behavior (IPV6_UNICAST_HOPS), record the libuv divergence. Target: node:dgram `setTTL`. Don't bug-for-bug copy this one — Node-on-libuv silently doesn't set IPv6 TTL on Windows; Bun can just be right. Validation ranges to keep: ttl 1..255, multicast_ttl -1..255 (udp.c:1001-1002).

### [SOCK-53] UDP disconnect = connect(AF_UNSPEC) — and on Windows the addrlen must be the FULL sockaddr_storage
- **What Windows does**: Disconnecting a connected UDP socket is `connect` with family AF_UNSPEC. Windows (like z/OS) validates `namelen` against the *currently stored* address length: passing a 16-byte `struct sockaddr` to disconnect an IPv6-connected socket fails WSAEINVAL/EINVAL.
- **How libuv handles it**: `uv__udp_disconnect` passes a fully zeroed `struct sockaddr_storage` with `sizeof(addr)` (udp.c:1070-1082) — zeroed storage means sa_family=AF_UNSPEC.
- **History**: a865f781 "bsd,windows,zos: fix udp disconnect EINVAL" (#3344/#3350) — the commit contains a comparative pseudocode tour of BSD/zOS/AIX/Linux kernel disconnect validation; Windows grouped with z/OS.
- **Bun disposition**: must-port. Target: node:dgram `disconnect()`. Use sockaddr_storage-sized zeroed addr on Windows, ignore/normalize the benign post-disconnect error codes (WSAEAFNOSUPPORT may still surface on some paths — treat disconnect-on-unconnected as EINVAL per API contract).

### [SOCK-54] UDP SO_REUSEADDR is opt-in (UV_UDP_REUSEADDR) but multicast membership FORCES it on implicit bind
- **What Windows does**: For UDP multicast, multiple listeners on one group/port require SO_REUSEADDR on Windows (REUSEADDR on UDP Windows ≈ BSD REUSEPORT-ish delivery for multicast, but unicast hijack semantics still apply — same caveat as SOCK-20).
- **How libuv handles it**: bind sets SO_REUSEADDR only when UV_UDP_REUSEADDR passed (udp.c:224-235; was default-on long ago, removed in 3558d65d to stop accidental port sharing); but all four set_membership functions implicitly bind with UV_UDP_REUSEADDR forced (udp.c:559-562, 613-616, 669-672, 724-727) so "join group on unbound handle" works like everyone expects.
- **History**: 3558d65d "do not set SO_REUSEADDR by default on udp"; 7c5ab1a7/91d95f8c/f91702a4 (the IPv6 source-membership scope_id handling: interface_addr is parsed and its sin6_scope_id used as the interface index, udp.c:623-629).
- **Bun disposition**: must-port. Target: node:dgram (`reuseAddr` option + `addMembership` auto-bind). Also carry the scope-id-as-interface-index parse for IPv6 membership.

### [SOCK-55] UDP implicit bind happens in exactly three operations; everything else is EBADF/EBADF-ish
- **What Windows does**: nothing — API surface discipline.
- **How libuv handles it**: send (udp.c:1098-1109), try_send (1140-1150), recv_start (319-324), connect (1047-1057), and set_membership (forced REUSEADDR) implicitly bind to the wildcard of the address's family; option setters (broadcast/multicast_if/ttl setters) require an existing socket and return UV_EBADF otherwise (udp.c:850-851, 881-882, 976-977). Early socket creation (`uv_udp_init_ex` with a family, udp.c:137-155) exists precisely so options can be set pre-bind (Unix parity).
- **History**: 386d2141 "be consistent when binding implicitly in UDP"; 0c283630 "allow setting udp socket options before bind" (#1842); f8f59824 "add ability to create tcp/udp sockets early".
- **Bun disposition**: should-port. Target: node:dgram semantics table. Node's dgram wrapper mostly hides this, but the implicit-bind matrix must match or `send-before-bind` breaks.

### [SOCK-56] UDP send-queue accounting: count in-flight reqs even when WSASendTo completed synchronously
- **What Windows does**: nothing — bookkeeping trap with SFCNM: a synchronous WSASendTo completion still has a req lifecycle.
- **How libuv handles it**: both completion classes increment `send_queue_count` (and add queued_bytes — 0 for sync completion since bytes already left) and both decrement in `uv__process_udp_send_req` (udp.c:376-390, 528-531); `uv__udp_try_send` refuses (UV_EAGAIN) whenever `send_queue_count != 0` to preserve ordering (udp.c:1136-1138).
- **History**: 377bf68a "windows: count queued bytes even if request completed immediately — The send_queue_size/count needs to maintain its value until right before the callback is called"; 6941cab5 fixed a buffer leak on failed udp send.
- **Bun disposition**: should-port (pattern). Target: node:dgram send path. The invariant "queue counters reflect not-yet-called-back requests, not kernel state" is what makes `uv_udp_get_send_queue_*` and EAGAIN-gating coherent.

### [SOCK-57] UDP close is simple (no RST dance) but completions still drain after closesocket
- **What Windows does**: closesocket on UDP aborts outstanding overlapped recvs with STATUS_CANCELLED-class errors; there is no graceful/abortive distinction to manage.
- **How libuv handles it**: `uv__udp_close` = recv_stop + closesocket + mark closing; endgame waits for `reqs_pending == 0` before freeing (udp.c:161-180) because the canceled recv/send completions still arrive through the IOCP and must find the handle alive.
- **History**: fabafd62 "windows: make sure sockets and handles are reset on close".
- **Bun disposition**: must-port (pattern). Target: AFD poll backend / node:dgram. Universal IOCP rule: a handle's memory lives until every submitted op's completion has been reaped — closesocket does not synchronously cancel.

### [SOCK-58] Error-code discipline: internal = Win32/WSA codes, egress points translate exactly once
- **What Windows does**: Three error namespaces (NTSTATUS, Win32/WSA, libuv/errno) — double-translation or missed translation both produce garbage codes.
- **How libuv handles it**: internal helpers (`uv__tcp_try_bind`, `uv__tcp_try_connect`, `uv__send`, `uv__udp_maybe_bind`...) return raw system errors; designated egress points are commented "This function is an egress point, i.e. it returns libuv errors rather than system errors" and apply `uv_translate_sys_error` once (tcp.c:1590-1622, udp.c:1024-1038, 1085-1116). Reqs store NTSTATUS, converted via GET_REQ_SOCK_ERROR at completion (SOCK-05).
- **History**: repeated bugs from violating this: 9918a174 (uv_tcp_nodelay/keepalive returned untranslated WSA codes), 57b3363e (uv_udp_recv_start double/missing translation), 13ca3bfa (udp connect), 288ec700 (udp membership). 23796d20 "Fixes #76. Unify OS error reporting" was the original unification.
- **Bun disposition**: must-port (architecture). Target: bun sys Windows error layer. Bun already has this discipline in bun.sys — extend it to the socket/AFD layer with the NTSTATUS table from SOCK-05 and keep the "translate once at the boundary" rule.

### [SOCK-59] uv_tcp_listen quirks: re-listen updates the callback; listen-after-read is WSAEISCONN; backlog asserted >0
- **What Windows does**: nothing — API semantics choices that node depends on.
- **How libuv handles it**: calling listen on an already-LISTENING handle just swaps `connection_cb` (tcp.c:618-620); listening on a handle in READING state returns WSAEISCONN (tcp.c:622-624); implicit bind to 0.0.0.0 if unbound (IPv4 only — an unbound AF_INET6-created handle binds v4 wildcard here, tcp.c:630-639); accept_reqs allocation is one-shot (re-listen after stop reuses it).
- **History**: original port; the re-listen-swaps-callback behavior is relied upon by node cluster round-robin re-arms.
- **Bun disposition**: should-port. Target: node:net listen compat. Mirror the error codes (EISCONN) — node tests assert them.

### [SOCK-60] SIO_LOOPBACK_FAST_PATH: never adopted — and that's the right call now
- **What Windows does**: `SIO_LOOPBACK_FAST_PATH` (Win8+) enabled TCP "Fast Path" over loopback (bypassing parts of the stack) when set on BOTH ends before connect/listen. From Win10 1607 the regular loopback path was optimized and the ioctl became effectively a no-op/deprecated.
- **How libuv handles it**: never used (verified: `git log -S SIO_LOOPBACK_FAST_PATH` is empty). The loopback optimization libuv DID adopt is SIO_TCP_INITIAL_RTO (SOCK-24).
- **History**: absence-of-code finding; multiple node issues proposed it ~2014-2016, never merged.
- **Bun disposition**: skip (deprecated/no-op on Bun's 1809+ baseline; setting it adds an ioctl + RSS for zero gain). Recorded so nobody "discovers" it later.

### [SOCK-61] TransmitFile / DisconnectEx socket-recycling: evaluated by the ecosystem, not used by libuv
- **What Windows does**: TransmitFile(TF_DISCONNECT|TF_REUSE_SOCKET) and DisconnectEx(TF_REUSE_SOCKET) return a socket to "unconnected" state for reuse with AcceptEx/ConnectEx, saving socket creation cost on high-churn servers. Costs: the reuse leaves the socket in TIME_WAIT-entangled state, has sharp edges with LSPs, and measurable wins are small post-Vista.
- **How libuv handles it**: not used anywhere (verified via log -S: only doc-file mentions, removed in d135122e "Remove iocp-links - out of date, wrong info"). Every accept creates a fresh WSASocketW; sendfile-ish APIs on Windows go through normal writes.
- **History**: absence-of-code; early (2011) design docs referenced them and were deleted as "wrong info".
- **Bun disposition**: skip (complexity not justified; fresh-socket cost is tiny on modern Windows; uSockets likewise creates fresh sockets). Record the rejection rationale.

### [SOCK-62] EMULATE_IOCP write reqs need a per-request event created at write time (not pooled)
- **What Windows does**: With event-based completion (SOCK-13), each concurrent overlapped op needs its own event; reusing one event across concurrent writes loses completions.
- **How libuv handles it**: `uv__tcp_write` under EMULATE_IOCP creates a fresh event per write req, tags it into hEvent|1, registers a ONE-SHOT wait (`WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE`) (tcp.c:954-960, 985-991); `uv__process_tcp_write_req` UnregisterWait + CloseHandle per req (tcp.c:1172-1181). Reads/accepts reuse a single event per req slot but re-register; their waits are NOT once-only (post_completion asserts !timed_out, tcp.c:425-441).
- **History**: 81c4043c; the WT flag asymmetry (write=ONLYONCE, read/accept=persistent slot re-registered manually) is deliberate — write reqs are user-allocated and transient.
- **Bun disposition**: should-port only with SOCK-13. Target: IPC socket transfer fallback path. If Bun rejects pre-associated sockets instead, this entire machinery is skippable — note the dependency.

### [SOCK-63] getsockname/getpeername go through one helper that honors delayed_error and EBADF-on-closed
- **What Windows does**: getsockname on an unbound/failed-bind socket gives confusing WSAEINVAL; libuv wants bind failures to surface consistently.
- **How libuv handles it**: `uv__getsockpeername` (core.c:835-856): uv_fileno first (catches closed handles → UV_EBADF), then returns translated `delayed_error` if set (so a deferred EADDRINUSE appears here too), then the real syscall. TCP passes its delayed_error; UDP passes 0 (udp.c:34-55, tcp.c:915-936).
- **History**: d16897c4 "unix: refactor getsockname/getpeername methods" unified the shape.
- **Bun disposition**: should-port. Target: node:net `address()`. Node's `server.address()` after a deferred bind error must return the error, not a bogus wildcard address.

### [SOCK-64] uv_tcp_init_ex validates family in the low byte and rejects all other flag bits
- **What Windows does**: nothing — forward-compat API hygiene.
- **How libuv handles it**: `domain = flags & 0xFF` must be AF_INET/AF_INET6/AF_UNSPEC; `flags & ~0xFF` → UV_EINVAL (tcp.c:220-229). On any later init failure the handle must be removed from the loop's handle queue (uv__queue_remove, tcp.c:241-243, 253, 260) because uv__stream_init already enqueued it — forgetting this corrupts the handle list (same pattern udp.c:133-135, 145, 152).
- **History**: f8f59824 (early socket creation introduced the failure paths).
- **Bun disposition**: skip (libuv-specific API shape) — but the "unwind partial handle registration on init failure" pattern is must-port wherever Bun mirrors handle queues. Target: engine

### [SOCK-65] The completion key is unused for dispatch — everything routes by OVERLAPPED pointer
- **What Windows does**: GetQueuedCompletionStatus returns (key, overlapped). Keying dispatch off the completion key breaks for emulated/posted completions and foreign sockets.
- **How libuv handles it**: sockets are associated with `(ULONG_PTR)socket` as key (tcp.c:170-173) but the loop ignores it; every completion is `CONTAINING_RECORD(overlapped, uv_req_t, u.io.overlapped)` and reqs carry their handle pointer (`req->data`/`req->handle`). This is what lets PostQueuedCompletionStatus-based emulation (SOCK-13) and uv_async share the port. (Stale comment "Use uv_handle_t pointer as completion key" at tcp.c:168-169 documents an older scheme — the code moved on, the comment didn't.)
- **History**: code archaeology; the comment/code divergence is itself the warning.
- **Bun disposition**: must-port (architecture). Target: engine

### [SOCK-66] WSAStartup-time wildcard sockaddr globals are shared mutable-looking state — treat as immutable
- **What Windows does**: nothing — concurrency hygiene.
- **How libuv handles it**: `uv_addr_ip4_any_`/`uv_addr_ip6_any_` (winsock.c:33-35) are written once during init and then read from every implicit bind/connect across all loops/threads (tcp.c:632, 836-839; udp.c:320, 560, 614...). Safe only because init happens-before any loop runs.
- **History**: code structure only.
- **Bun disposition**: skip (Bun should use const statics — Rust makes this free). Recorded because a naive port that re-derives them lazily per loop reintroduces a benign-looking but real data race.

---

## Counts (primary disposition per entry)
- Total quirks: 66
- must-port: 46 — SOCK-01, 04, 05, 07, 08, 09, 10, 11, 12, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 57, 58, 65
- should-port: 16 — SOCK-02, 03, 06, 13, 14, 16, 26, 29, 42, 44, 45, 55, 56, 59, 62, 63
- skip: 4 — SOCK-60 (SIO_LOOPBACK_FAST_PATH: deprecated/no-op on 1809+), SOCK-61 (TransmitFile/DisconnectEx reuse: rejected by libuv too, complexity > win), SOCK-64 (libuv-specific API flag shape; embedded handle-queue-unwind sub-lesson is must-port), SOCK-66 (use const statics in Rust instead; recorded to prevent a lazy-init race regression)
