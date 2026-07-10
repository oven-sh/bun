# Ledger: poll (src/win/poll.c + AFD pieces of winsock.c/winsock.h/winapi.c)

Sources: libuv worktree C:/Users/dylan/code/libuv-read (line refs below are into that tree),
Bun patch C:/Users/dylan/code/bun/.claude/worktrees/busy-vaughan-130bdf/patches/libuv/win-poll-rearm-before-callback.patch,
Bun dep config scripts/build/deps/libuv.ts. Bun's only first-party uv*poll consumer today is c-ares DNS
(src/runtime/dns_jsc/dns.rs); NAPI re-exports uv_poll*\* to addons (src/runtime/napi/napi_body.rs).

### [POLL-01] Poll sockets by issuing IOCTL_AFD_POLL directly to the AFD kernel driver

- **What Windows does**: Win32/winsock has no IOCP-compatible readiness API. WSAPoll/select are blocking; WSAEventSelect needs WaitForMultipleObjects (64-handle limit, no IOCP). The only way to get "socket became readable" as an IOCP completion is the undocumented IOCTL_AFD_POLL on the Auxiliary Function Driver (\Device\Afd), the kernel component winsock dispatches to.
- **How libuv handles it**: `uv__msafd_poll()` calls `pNtDeviceIoControlFile(..., IOCTL_AFD_POLL, info_in, sizeof, info_out, sizeof)` (src/win/winsock.c:463-547). The comment at src/win/winsock.h:105-110 states the rationale: "Having these definitions allows us to bypass winsock and make an AFD kernel call directly." Same approach as wepoll and mio.
- **History**: 19aca7a7 (2012, "Windows: add uv_msafd_poll, to support overlapped socket polling") added it for the original uv_poll implementation d7a71761.
- **Bun disposition**: must-port. This _is_ the Windows socket-readiness mechanism; every alternative (select threads, WSAEventSelect threads) is strictly worse. Target: native Windows sys/loop poll module (AFD readiness source).

### [POLL-02] AFD control codes use a nonstandard encoding — do NOT use CTL_CODE

- **What Windows does**: AFD ioctl numbers are not built with the standard `CTL_CODE(dev<<16|acc<<14|fn<<2|m)` macro. AFD packs `(FSCTL_AFD_BASE << 12) | (operation << 2) | method`. IOCTL_AFD_POLL = (0x12 << 12) | (9 << 2) | METHOD_BUFFERED = 0x00012024. Using CTL_CODE(FILE_DEVICE_NETWORK, 9, ...) yields 0x120024 — wrong, the driver rejects it.
- **How libuv handles it**: hand-rolled `_AFD_CONTROL_CODE` macro and operation numbers AFD_RECEIVE=5, AFD_RECEIVE_DATAGRAM=6, AFD_POLL=9 (src/win/winsock.h:159-175). Also note IOCTL_AFD_POLL is METHOD_BUFFERED while the receive ioctls are METHOD_NEITHER — buffering method matters for buffer lifetime (see POLL-34).
- **History**: 51e9dbc2 (2011) introduced the AFD definitions; code comment only. wepoll defines the same 0x00012024 constant.
- **Bun disposition**: must-port. Hard-code 0x00012024 with a comment deriving it; a from-scratch impl using CTL_CODE will fail mysteriously. Target: sys/windows AFD constants.

### [POLL-03] AFD_POLL_INFO ABI is undocumented and must be replicated bit-exactly

- **What Windows does**: The kernel parses the input buffer as `{LARGE_INTEGER Timeout; ULONG NumberOfHandles; ULONG Exclusive; {HANDLE Handle; ULONG Events; NTSTATUS Status}[N]}` — pointer-sized Handle means the struct differs between x64/arm64 and x86; on 64-bit the offsets are Timeout [0,8), NumberOfHandles [8,12), Exclusive [12,16), Handles [16,32) with zero padding. Wrong layout = STATUS_INVALID_PARAMETER or garbage polls.
- **How libuv handles it**: `AFD_POLL_HANDLE_INFO`/`AFD_POLL_INFO` typedefs in include/uv/win.h:206-217, identical to wepoll's afd.h and ReactOS's drivers/network/afd.
- **History**: d7a71761 (2012); never changed. Code comment only.
- **Bun disposition**: must-port. `#[repr(C)]` structs with a layout test against known offsets. ERRATUM (caught at implementation): this entry originally cited 0x10/0x14/0x18 — those are +8 off. Actual x64 layout transcribed from `include/uv/win.h` (matches wepoll): NumberOfHandles=0x8, Exclusive=0xC, Handles=0x10, sizeof=0x20; pinned by compile-time asserts in `src/windows_sys/externs.rs`. Target: sys/windows AFD types.

### [POLL-04] AFD poll is level-triggered at IRP arrival — events occurring while no IRP is pending are NOT lost

- **What Windows does**: When an IOCTL_AFD_POLL IRP arrives, AFD immediately checks the socket's latched poll state (ReactOS AfdSelect: `Events & FCB->PollState`) and completes the IRP at once if any requested condition already holds; otherwise it parks the IRP until a condition arises. So the primitive is one-shot per IRP but level-triggered at submission.
- **How libuv handles it**: the whole design leans on this: each completion is processed, then a fresh poll is submitted (`uv__fast_poll_submit_poll_req`, src/win/poll.c:77-136), and stale-but-still-true conditions re-complete the fresh IRP instantly. This is what makes the emulation level-triggered overall.
- **History**: implicit since d7a71761; spelled out explicitly only in Bun's patch comment (win-poll-rearm-before-callback.patch lines 7-19, citing ReactOS AfdSelect).
- **Bun disposition**: must-port (as a design invariant, documented in the module header). Every re-arm/ordering decision below depends on it. Target: native AFD poll module design doc/comments.

### [POLL-05] Per-loop, per-provider "peer socket" as the IRP conduit (don't IOCP-associate the user's socket)

- **What Windows does**: a HANDLE can be associated with exactly one IOCP, forever. The user's socket may already be associated with their own IOCP (or another loop's), so the loop cannot bind it to its IOCP to receive poll completions. However, AFD lets one AFD handle issue a poll IRP _targeting a different socket_ via `Handles[0].Handle`; the completion is delivered through the issuing handle's IOCP association.
- **How libuv handles it**: one helper "peer socket" per (loop, MSAFD provider) — `loop->poll_peer_sockets[UV_MSAFD_PROVIDER_COUNT]` (include/uv/win.h:344) — created on demand (`uv__fast_poll_create_peer_socket`, src/win/poll.c:205-231), associated with the loop IOCP, then every poll req for any watched socket of that provider is submitted _via the peer_: `uv__msafd_poll((SOCKET)handle->peer_socket, ...)` with `Handles[0].Handle = handle->socket` (src/win/poll.c:104-130).
- **History**: d7a71761 (2012). wepoll/mio solved the same problem differently: they NtCreateFile a raw `\Device\Afd\<name>` helper handle (no winsock, works for all providers).
- **Bun disposition**: must-port the concept. Recommend wepoll/mio's raw \Device\Afd handle over per-provider peer sockets (one handle for all providers, no WSAStartup dependency, no provider table for the conduit) — but then POLL-07's provider check changes meaning (see there). Target: native AFD poll module init.

### [POLL-06] Create the peer from the watched socket's own WSAPROTOCOL_INFOW (base catalog entry)

- **What Windows does**: `WSASocketW(..., &protocol_info, ...)` with an explicit WSAPROTOCOL*INFOW creates a socket from that exact catalog entry — bypassing any LSP layered on the default chain. The protocol info obtained from the \_base* socket names the clean MSAFD entry. Note TCP/UDP/RAW share one ProviderId GUID per family, so one peer serves all three socket types.
- **How libuv handles it**: `getsockopt(SO_PROTOCOL_INFOW)` on the (unwrapped) socket (src/win/poll.c:447-455), then `WSASocketW(protocol_info->iAddressFamily, iSocketType, iProtocol, protocol_info, 0, WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT)` (src/win/poll.c:209-214).
- **History**: d7a71761. Code comment only.
- **Bun disposition**: must-port if peer-socket design is kept; moot if using a raw \Device\Afd handle. Target: native AFD poll module init.

### [POLL-07] Whitelist of exactly 4 MSAFD provider GUIDs; everything else is rejected from fast poll

- **What Windows does**: only sockets whose base provider is MSAFD are AFD handles that understand IOCTL_AFD_POLL. Third-party providers (SAN providers, VPN/firewall providers that replace rather than layer) hand out non-AFD handles; sending AFD ioctls to them fails or misbehaves.
- **How libuv handles it**: `uv_msafd_provider_ids[4]` (src/win/poll.c:31-40): {e70f1aa0-ab8b-11cf-...} MSAFD Tcpip IPv4, {f9eab0c0-26d4-11d0-...} MSAFD Tcpip IPv6, {9fc48064-7298-43e4-...} MSAFD RfComm (Bluetooth), {a00943d9-9c2e-4633-...} AF_UNIX (Win10). `uv__fast_poll_get_peer_socket` memcmps ProviderId against the table (src/win/poll.c:239-251); no match → INVALID_SOCKET → slow mode (src/win/poll.c:457-468). Notably ABSENT: Hyper-V sockets (AF_HYPERV) — they fall to the slow path today.
- **History**: first 3 GUIDs in d7a71761 (2012); AF_UNIX GUID added 8e67d8b3 (#3511, 2022) specifically to get fast poll for Win10 Unix sockets.
- **Bun disposition**: must-port (the knowledge that GUID == "is this really AFD"). With a wepoll-style design you can instead "try the poll and treat STATUS_OBJECT_TYPE_MISMATCH/STATUS_INVALID_HANDLE (→WSAENOTSOCK, src/win/winsock.c:147-149) as not-AFD". Keep the 4 GUIDs in a comment either way; add AF_HYPERV's GUID consideration if Bun ever polls Hyper-V sockets. Target: native AFD poll module socket classification.

### [POLL-08] Peer-socket cache is 3-state: 0 = never tried, INVALID_SOCKET = tried-and-failed (never retry), else valid

- **What Windows does**: peer creation can fail persistently (provider broken, handle/IOCP association failure). Retrying per poll handle would hammer a broken provider.
- **How libuv handles it**: `loop->poll_peer_sockets` zero-initialized at loop init (src/win/core.c:283); `uv__fast_poll_get_peer_socket` creates only when slot == 0 and stores the result _including INVALID_SOCKET on failure_ so it never retries (src/win/poll.c:253-259, comment "Don't try again if the peer socket creation failed earlier for the same protocol").
- **History**: d7a71761. Code comment only.
- **Bun disposition**: must-port (treat "unset", "failed", "present" as three distinct states — classic Bun review lesson too). Target: native AFD poll module init.

### [POLL-09] Peer creation failure path: close the socket if IOCP association fails

- **What Windows does**: `CreateIoCompletionPort((HANDLE)sock, iocp, key, 0)` can fail (e.g. handle already associated, resource exhaustion); the socket is then useless as a conduit.
- **How libuv handles it**: `uv__fast_poll_create_peer_socket` does WSASocketW → CreateIoCompletionPort → on failure `closesocket` + return INVALID_SOCKET (src/win/poll.c:205-231). Completion key is the socket value but is never consulted — dispatch is purely by OVERLAPPED pointer → req (src/win/core.c:495-497).
- **History**: d7a71761.
- **Bun disposition**: must-port (RAII guard around the socket until association succeeds; key can be a constant/tag in Bun's design). Target: native AFD poll module init.

### [POLL-10] Create the peer socket with WSA_FLAG_NO_HANDLE_INHERIT (atomic), not SetHandleInformation-after

- **What Windows does**: a handle created inheritable then flipped non-inheritable leaves a race window: a concurrent CreateProcess between creation and SetHandleInformation leaks the handle into the child (child then keeps the peer socket — and its IOCP refs — alive).
- **How libuv handles it**: `WSA_FLAG_OVERLAPPED | WSA_FLAG_NO_HANDLE_INHERIT` at WSASocketW time (src/win/poll.c:209-214). WSA_FLAG_NO_HANDLE_INHERIT exists since Win7 SP1/Win8.
- **History**: 5f3c0d3d (#4810, June 2025) for poll.c, then d19855c7 (#5097, 2026) for all remaining WSASocketW sites: "Resolves a potential race condition when a child process has been created between WSASocketW() and SetHandleInformationW()".
- **Bun disposition**: must-port (Bun baseline 1809 always has the flag; never use the two-step dance). Target: all native socket creation, cross-ref: tcp/udp areas.

### [POLL-11] Unwrap LSP layering with SIO_BASE_HANDLE at init; failure is silently tolerated

- **What Windows does**: Layered Service Providers wrap sockets; the wrapped SOCKET is not an AFD handle even when the base is. `WSAIoctl(SIO_BASE_HANDLE)` returns the bottom-of-stack socket. On a clean system it returns the same handle. MinGW's headers historically lacked the constant.
- **How libuv handles it**: at `uv_poll_init_socket`, tries SIO_BASE_HANDLE and on success replaces `socket` with the base for ALL subsequent operations (poll targets the base; the user keeps doing I/O on the wrapper — same FCB underneath so readiness agrees) (src/win/poll.c:423-441). Failure falls through silently and the provider check decides fast vs slow. `#ifndef SIO_BASE_HANDLE # define SIO_BASE_HANDLE 0x48000022` (src/win/winsock.h:49-51). Debug-only `base_socket = INVALID_SOCKET` init plus assert that success returns a sane handle (src/win/poll.c:426-439).
- **History**: d7a71761; comment originally noted it "will always fail on windows XP/2k3" — XP text dropped in a7b16bfb (2022, min req Win8).
- **Bun disposition**: must-port (always attempt unwrap; poll the base handle). Target: native AFD poll socket registration.

### [POLL-12] libuv does NOT have wepoll/mio's Komodia fallback (SIO_BSP_HANDLE_POLL loop) for hostile LSPs

- **What Windows does**: Komodia-based LSPs (SuperFish-family adware/AV) intercept SIO_BASE_HANDLE and deliberately break it (to prevent LSP bypass), though MS docs say LSPs must never intercept it. They don't intercept SIO_BSP_HANDLE_POLL, which returns the next-lower socket in the chain.
- **How libuv handles it**: it doesn't — SIO_BASE_HANDLE failure just means the provider check runs on the wrapped socket, GUID won't match, handle silently degrades to the select()-thread slow path. wepoll's ws_get_base_socket loops SIO_BASE_HANDLE → SIO_BSP_HANDLE_POLL → repeat; mio's get_base_socket tries SIO_BASE_HANDLE then SIO_BSP_HANDLE_SELECT/SIO_BSP_HANDLE_POLL/SIO_BSP_HANDLE.
- **History**: gap is original; wepoll grew the workaround circa 2018 (Komodia incident).
- **Bun disposition**: should-port (edge environments: old AV/adware LSPs on consumer machines; LSPs are deprecated since Win8 but still encountered). If Bun has no slow path, this fallback is the difference between "works" and "loud error" on such machines. Target: native AFD poll socket registration.

### [POLL-13] uv_poll_init sets the socket non-blocking (FIONBIO) on the caller's behalf

- **What Windows does**: nothing automatic; a blocking socket polled as "readable" then read can still block in surprising ways, and POSIX parity expects non-blocking semantics.
- **How libuv handles it**: `ioctlsocket(socket, FIONBIO, &yes)` first thing in `uv_poll_init_socket`, before unwrap (on the wrapper, which propagates down the LSP chain); failure aborts init with the translated error (src/win/poll.c:417-421).
- **History**: b30a3e67 (#136, 2015): "libuv requires that the socket/fd is in non-blocking mode, so do it internally so the user doesn't need to write platform specific code". Documented as versionchanged 1.2.2 in docs/src/poll.rst.
- **Bun disposition**: must-port (c-ares sockets arrive already non-blocking but don't rely on it; cheap and idempotent). Target: native AFD poll socket registration.

### [POLL-14] Identify the provider with getsockopt(SO_PROTOCOL_INFOW) and return real error codes from init

- **What Windows does**: SO_PROTOCOL_INFOW yields the catalog entry (ProviderId GUID, family/type/protocol) of the socket — on the base socket this is the true bottom provider. Fails with WSAENOTSOCK for dead/invalid handles.
- **How libuv handles it**: src/win/poll.c:447-455; failure returns `uv_translate_sys_error(WSAGetLastError())` so a closed/invalid SOCKET surfaces as UV_ENOTSOCK at init rather than later (WSAENOTSOCK→UV_ENOTSOCK, src/win/error.c:155).
- **History**: 416b7335 (2014, #1518) converted init to return libuv error codes; c0716b3d (2013) fixed the _fd_ path: `_get_osfhandle()` reports via errno not \_doserrno, and raises a CRT assert dialog on invalid fds in debug builds — hence the `uv__get_osfhandle` wrapper that disables CRT asserts around the call (src/win/handle-inl.h:98-110, used at src/win/poll.c:406-408).
- **Bun disposition**: must-port the SO_PROTOCOL_INFOW probe + early validation. The CRT-fd wrapper: should-port only where Bun maps CRT fds to sockets (NAPI compat paths). Target: native AFD poll socket registration.

### [POLL-15] Two alternating poll reqs per handle — the minimum needed to change the event set mid-flight

- **What Windows does**: an in-flight IRP's OVERLAPPED cannot be reused until completion; you cannot modify a pending AFD poll's event mask — you must submit a replacement (which, via Exclusive, kicks the old one; the kick is asynchronous).
- **How libuv handles it**: each handle owns `poll_req_1/2`, `afd_poll_info_1/2`, `submitted_events_1/2`, `mask_events_1/2` (include/uv/win.h:532-545). Submit picks the free slot; if BOTH are busy it just returns — comment: "Just wait until there's an unsubmitted req... one of the 2 outstanding requests is about to return" because the latest submission was Exclusive and is kicking the other (src/win/poll.c:82-102). The post-completion tail re-checks `handle->events & ~(submitted_1|submitted_2)` and submits then (src/win/poll.c:194-196).
- **History**: d7a71761; design unchanged for 14 years.
- **Bun disposition**: must-port (two slots exactly; a single slot cannot express "update while pending", more than two is pointless). Target: native AFD poll per-socket state.

### [POLL-16] mask_events bookkeeping prevents double-reporting when a req is kicked by its replacement

- **What Windows does**: level-trigger means the replacement poll re-reports conditions the kicked poll may also report on its way out — same event could be delivered twice.
- **How libuv handles it**: at submit of slot X: `mask_events_X = 0; mask_events_OTHER = handle->events` (src/win/poll.c:83-94) — i.e. "suppress from the OLD req everything the NEW req now covers". At completion: `events &= handle->events & ~mask_events` (src/win/poll.c:180, slot resolution 144-155). The AND with current `handle->events` also filters events the user no longer wants (e.g. after uv_poll_stop with an IRP still pending).
- **History**: d7a71761.
- **Bun disposition**: must-port (exact algebra; this is the part a from-scratch impl gets subtly wrong and double-fires callbacks). Target: native AFD poll per-socket state.

### [POLL-17] Exclusive=TRUE on every submission = cancel-by-resubmit, keyed on the TARGET socket (FCB), not the issuing handle

- **What Windows does**: an IOCTL*AFD_POLL with Exclusive=TRUE forces other pending poll IRPs \_for the same underlying socket endpoint* to complete (ReactOS AfdSelect kills other poll IRPs on the same FCB). Proof it's per-target-FCB: libuv's normal reqs are issued via the shared peer socket and the close-time cancel via the watched socket itself, and they still kick each other; meanwhile polls for different sockets through the same peer never interact.
- **How libuv handles it**: every fast-path submission sets `Exclusive = TRUE` — comment: "Setting Exclusive to TRUE makes the other poll request return if there is any" (src/win/poll.c:104-106). A kicked IRP completes either with `NumberOfHandles == 0` (handled by the `>= 1` guard, src/win/poll.c:165) or STATUS_CANCELLED (see POLL-24); both are silent.
- **History**: d7a71761; semantics confirmed by 07f01752 (the cancel poll only works with Exclusive=TRUE + infinite timeout, see POLL-32).
- **Bun disposition**: must-port the semantics knowledge even if Bun cancels differently (wepoll/mio use NtCancelIoFileEx on the specific IRP instead — cleaner on 1809+, no kick-side-effects). WARNING to carry: because Exclusive matches per-socket process-wide, any OTHER code in the process doing exclusive AFD polls on the same socket cancels yours (see POLL-37). Target: native AFD poll submit/cancel design.

### [POLL-18] Timeout.QuadPart = INT64_MAX — never let AFD time the poll out

- **What Windows does**: AFD_POLL_INFO.Timeout is an absolute/relative LARGE_INTEGER deadline; an expiring poll completes with no events, which would look like a spurious wakeup and burn a resubmit cycle.
- **How libuv handles it**: INT64_MAX on every submission including the cancel poll (src/win/poll.c:108, 554). Timer logic lives entirely in the loop, never in AFD.
- **History**: d7a71761; 528123ad briefly set the cancel poll's timeout to 0 (immediate) which contributed to the close hang fixed the next day by 07f01752 (a zero-timeout non-exclusive poll completes itself without kicking anything).
- **Bun disposition**: must-port. Target: native AFD poll submit.

### [POLL-19] Submit-side event mapping: UV_READABLE implies ACCEPT+DISCONNECT+ABORT; DISCONNECT-only gets no ABORT

- **What Windows does**: AFD splits POSIX "readable" into RECEIVE (data), ACCEPT (listen backlog), DISCONNECT (peer FIN), ABORT (peer RST); and "writable" into SEND and CONNECT_FAIL (async connect() failed). There is no POLLHUP/POLLERR-style always-on reporting — you only get events you asked for.
- **How libuv handles it**: UV_READABLE → `AFD_POLL_RECEIVE | AFD_POLL_DISCONNECT | AFD_POLL_ACCEPT | AFD_POLL_ABORT`; else if UV_DISCONNECT → `AFD_POLL_DISCONNECT` only (note: no ABORT — RST is not reported to a DISCONNECT-only watcher, a deviation from POSIX POLLHUP-ish expectations); UV_WRITABLE → `AFD_POLL_SEND | AFD_POLL_CONNECT_FAIL` (src/win/poll.c:113-123).
- **History**: d7a71761; UV_DISCONNECT added c7c8e916 (#691, 2016) mapping AFD_POLL_DISCONNECT ≈ EPOLLRDHUP.
- **Bun disposition**: must-port exactly (c-ares asks for READABLE/WRITABLE; the implicit ABORT subscription is what makes RST wake reads). Document the DISCONNECT-only/no-ABORT wrinkle. Target: native AFD poll event translation.

### [POLL-20] UV_PRIORITIZED is accepted but silently never delivered on Windows

- **What Windows does**: AFD has AFD_POLL_RECEIVE_EXPEDITED (OOB/MSG_OOB data) which would correspond to POLLPRI.
- **How libuv handles it**: `uv__poll_set` allows the bit in its assert (src/win/poll.c:488-489) but the submit path never maps it to RECEIVE_EXPEDITED — the constant is defined (src/win/winsock.h:118-119) and unused. test/test-poll-oob.c is `#if !defined(_WIN32)`. wepoll DOES map EPOLLPRI ↔ AFD_POLL_RECEIVE_EXPEDITED.
- **History**: 2ce720c6 (#3171, 2021) — passing UV_PRIORITIZED used to abort the process via assert; fix was to permit-and-ignore rather than implement.
- **Bun disposition**: skip (reason: no Bun consumer uses POLLPRI; c-ares never requests it; TCP OOB is a dead feature). If ever needed, the wepoll mapping is one line. Target: n/a (document in module comment).

### [POLL-21] Completion-side mapping: {RECEIVE,ACCEPT,DISCONNECT,ABORT}→readable, DISCONNECT adds UV_DISCONNECT, {SEND,CONNECT_FAIL}→writable

- **What Windows does**: the completed AFD_POLL_INFO echoes the triggered event bits in Handles[0].Events (per-handle Status NTSTATUS is also written; libuv ignores it).
- **How libuv handles it**: src/win/poll.c:165-180. ABORT (RST) and DISCONNECT (FIN) both surface as UV_READABLE so the consumer's read() observes ECONNRESET/EOF — POSIX-poll parity. CONNECT_FAIL surfaces as UV_WRITABLE so a connect()-watcher wakes and getsockopt(SO_ERROR)/read reveals the failure — matches select()'s exceptfds behavior (mirrored in the slow path, src/win/poll.c:315-323).
- **History**: d7a71761; UV_DISCONNECT pass-through added c7c8e916.
- **Bun disposition**: must-port exactly; c-ares's process loop depends on failed connects being reported as writable. Target: native AFD poll event translation.

### [POLL-22] AFD_POLL_LOCAL_CLOSE means "the watched socket was closed locally" — stop the watcher, with an is-active guard

- **What Windows does**: if the process closesocket()s the watched socket while a poll IRP is pending, AFD completes the IRP with AFD_POLL_LOCAL_CLOSE. Continuing to poll would target a dead/recycled handle value (the handle can be REUSED by a new socket — polling it would watch the wrong socket).
- **How libuv handles it**: on LOCAL_CLOSE: `handle->events = 0; if (uv__is_active(handle)) uv__handle_stop(handle);` (src/win/poll.c:182-187). Events computed in the same completion are still delivered after the stop (delivery check at 189-191). The `uv__is_active` guard exists because the handle may ALREADY be closing (uv_close deactivated it) when the LOCAL_CLOSE completion drains — double-stop corrupted the loop's active-handle accounting.
- **History**: dd1355da (2012) added the stop; eee47765/12bb46c0 (2014, fixes #1278) added the guard + test test-poll-closesocket.c (scenario: poll_cb restarts poll, closesocket()s, then uv_close()s — all within the callback). Docs (docs/src/poll.rst:25-28) codify: closing the fd while active "can cause the handle to report an error, but it might also start polling another socket".
- **Bun disposition**: must-port (both the stop and the already-stopping guard; mirror with fd-reuse-safe bookkeeping). Target: native AFD poll completion handling.

### [POLL-23] WSAEINTR (STATUS_CANCELLED) completions are swallowed and transparently re-armed

- **What Windows does**: a poll IRP cancelled by CancelIoEx, handle close, or an Exclusive kick completes with STATUS_CANCELLED (also STATUS_REQUEST_ABORTED), which libuv's NTSTATUS table maps to WSAEINTR (src/win/winsock.c:195-197).
- **How libuv handles it**: error path: `if (error != WSAEINTR && handle->events != 0) { stop watcher; poll_cb(error) }` — WSAEINTR falls through silently and the tail resubmit re-arms if the user still wants events (src/win/poll.c:157-163, 194-196). This is what makes the Exclusive kick (POLL-17) and external cancels invisible to users.
- **History**: d7a71761 ("Report an error unless the select was just interrupted").
- **Bun disposition**: must-port (treat cancellation as "re-arm, not error"). Target: native AFD poll completion handling.

### [POLL-24] Genuine poll errors stop the watcher and are reported exactly once — and only if still wanted

- **What Windows does**: a poll IRP can complete with real errors (WSAENOTSOCK after the socket died, WSAENOBUFS under quota pressure, etc.). Resubmitting would spin: the same error completes immediately, forever (a busyloop libuv's docs warn about).
- **How libuv handles it**: `handle->events = 0` BEFORE invoking `poll_cb(handle, uv_translate_sys_error(error), 0)` (stops the watcher so no resubmit), and skips the callback entirely if `handle->events == 0` already (user stopped meanwhile) (src/win/poll.c:157-163; slow path mirror 380-386). Docs: UV_EBADF-style errors discontinue polling; user must uv_close.
- **History**: d7a71761.
- **Bun disposition**: must-port (error => disarm-then-callback ordering matters: the callback may restart the poll, which must not race the disarm). Target: native AFD poll completion handling.

### [POLL-25] Spurious readiness is part of the contract — consumers MUST handle EAGAIN/EWOULDBLOCK

- **What Windows does**: level-trigger emulation via repeated one-shot polls inherently re-reports conditions consumed between completion and processing; the Exclusive kick can also complete a poll with events the user already serviced.
- **How libuv handles it**: documented contract, docs/src/poll.rst:16-19: "poll handles occasionally signal that a file descriptor is readable or writable even when it isn't. The user should therefore always be prepared to handle EAGAIN". The mask algebra (POLL-16) minimizes but cannot eliminate duplicates.
- **History**: documented since the feature shipped.
- **Bun disposition**: must-port as a contract on Bun's poll consumers (c-ares already tolerates EWOULDBLOCK; any future consumer must). Note: Bun's re-arm-before-callback patch slightly INCREASES spurious wakeups (fresh IRP can complete with stale READABLE before the callback drains the socket) — accepted cost. Target: native AFD poll consumer contract.

### [POLL-26] THE BUN PATCH: re-arm the AFD poll BEFORE invoking poll_cb (win-poll-rearm-before-callback.patch)

- **What Windows does**: between an IOCP completion and the next IOCTL_AFD_POLL submission, NO IRP is pending; conditions arising in that window are latched in AFD's PollState but produce no completion packet until a new IRP arrives (POLL-04).
- **How libuv handles it**: stock libuv processes the completion → computes events → calls `poll_cb` → THEN re-arms (src/win/poll.c:189-196). Bun's patch hoists a re-arm to before the callback, inside the success branch after LOCAL_CLOSE handling, keeping the post-callback re-arm for the events==0/filtered path and the close/endgame check (patch lines 20-27, 30-36). **The race it fixes**: while poll_cb runs arbitrary user code, stock libuv has no pending IRP. Bun's poll_cb runs JS which drains microtasks; those can synchronously cause the watched socket's peer (same process, loopback — e.g. `fetch().abort()` RSTing a connection the DNS/poll callback is entangled with) to transition the socket (AFD_POLL_ABORT latched). With re-arm-after-callback, no completion packet exists during the callback, so any code that pumps/waits on the IOCP from within that callback context (nested tick, drainMicrotasks that processes IO) never sees the abort → missed wakeup/hang; even without nested pumping, delivery slips a full extra loop iteration. With re-arm-before-callback, an IRP is pending while user code runs: the RST completes it immediately and the packet is already queued when anything next polls the IOCP. **What the native loop must preserve**: (1) an AFD poll IRP must be pending whenever user JS runs in response to a poll event — submit-before-dispatch; (2) safe because AFD is level-triggered at IRP arrival (ReactOS AfdSelect checks `Events & FCB->PollState`), so early re-arm loses nothing and double-reports are absorbed by mask/filter bookkeeping (POLL-16) which "already handles poll_cb calling uv_poll_start/stop mid-flight" (patch comment); (3) wepoll ordering parity: port_wait → port\_\_update_events_if_polling re-arms before LeaveCriticalSection/returning, so epoll_wait callers always run with IRPs pending.
- **History**: Bun-local patch (patches/libuv/win-poll-rearm-before-callback.patch), applied via scripts/build/deps/libuv.ts:51 onto oven-sh/libuv `bun` branch (upstream f3ce527e); libuv.ts:43-50 notes intent to upstream with the wepoll/ReactOS rationale. Upstream libuv still has the old order.
- **Bun disposition**: must-port — THE critical ordering constraint for the native loop. Generalize: for every level-triggered-emulated readiness source, re-arm before dispatching to user code. Target: native AFD poll completion dispatch (highest priority).

### [POLL-27] poll_cb may reenter: uv_poll_start/stop/uv_close (and closesocket) from inside the callback must be safe

- **What Windows does**: nothing — this is pure state-machine discipline.
- **How libuv handles it**: all submission decisions are re-derived AFTER the callback from current state: tail block checks `handle->events & ~(submitted_1|submitted_2)` then the closing/endgame condition (src/win/poll.c:194-201). `uv__poll_set` asserts not-closing, handles events==0 as stop, and only submits the missing delta (src/win/poll.c:483-511). uv_poll_stop is uv\_\_poll_set(events=0) (src/win/poll.c:519-521, DRY'd by 887cf62c/b29612fe). test-poll-closesocket.c exercises restart+closesocket+close inside the callback.
- **History**: d7a71761 design; hardened by #1278 fix (POLL-22).
- **Bun disposition**: must-port (re-derive submissions from post-callback state; never cache "what to do next" across a user callback). Target: native AFD poll dispatch.

### [POLL-28] Synchronous submit failure is converted into an asynchronous error completion via the pending-req queue

- **What Windows does**: NtDeviceIoControlFile can fail immediately (WSAENOTSOCK on a dead socket, WSAENOBUFS...). Reporting synchronously from uv_poll_start would create two error-delivery paths for users.
- **How libuv handles it**: `SET_REQ_ERROR(req, WSAGetLastError()); uv__insert_pending_req(loop, req)` — the req is queued as if it had completed, and the normal completion path reports it on the next loop iteration (src/win/poll.c:131-135; slow path QueueUserWorkItem failure mirror 353-359).
- **History**: d7a71761.
- **Bun disposition**: must-port (single error-delivery funnel; also keeps `submitted_events_X` accounting consistent — the slot is "in flight" either way). Target: native AFD poll submit.

### [POLL-29] OVERLAPPED.Internal doubles as the IO_STATUS_BLOCK; req status stored as NTSTATUS (NTSTATUS_FROM_WIN32)

- **What Windows does**: the NT I/O manager treats the first two pointer-sized fields of OVERLAPPED as the IOSB: Internal = NTSTATUS, InternalHigh = Information. Passing `(IO_STATUS_BLOCK*)&overlapped->Internal` to NtDeviceIoControlFile makes completion status land where Win32 expects it.
- **How libuv handles it**: `iosb_ptr = (IO_STATUS_BLOCK*)&overlapped->Internal` (src/win/winsock.c:474); req macros store/read NTSTATUS in overlapped.Internal: SET_REQ_ERROR = NTSTATUS_FROM_WIN32, REQ_SUCCESS = NT_SUCCESS(Internal), GET_REQ_SOCK_ERROR = uv\_\_ntstatus_to_winsock_error(Internal) (src/win/req-inl.h:31-53). Fast path zeroes the overlapped before each submit (src/win/poll.c:125); slow path smuggles its event bits through InternalHigh (src/win/poll.c:327, 389).
- **History**: d7a71761/19aca7a7.
- **Bun disposition**: must-port (the IOSB-overlap is the standard trick Bun's native loop will use for every NT-level submission; keep the NTSTATUS-not-Win32 convention straight or error translation double-converts). Target: sys/windows overlapped/req plumbing, cross-ref: LOOP.

### [POLL-30] Prime iosb->Status = STATUS_PENDING before submitting

- **What Windows does**: the kernel writes the IOSB at completion; until then its content is whatever you left there. Code (or GetOverlappedResult-style helpers) that inspects status before completion would read garbage and could mistake a stale STATUS_SUCCESS for done.
- **How libuv handles it**: `iosb_ptr->Status = STATUS_PENDING;` immediately before NtDeviceIoControlFile (src/win/winsock.c:495; also 305, 403 in the recv workarounds).
- **History**: 19aca7a7. wepoll does the same.
- **Bun disposition**: must-port (cheap and prevents an entire class of "completed-before-it-started" bugs). Target: sys/windows NT submission helper.

### [POLL-31] Synchronous IOCTL completion still posts to the IOCP — treat STATUS_SUCCESS and STATUS_PENDING identically at submit

- **What Windows does**: if the polled condition already holds, NtDeviceIoControlFile returns STATUS_SUCCESS synchronously — and because the peer socket's IOCP association has no FILE_SKIP_COMPLETION_PORT_ON_SUCCESS, a completion packet is STILL queued. Handling sync-success inline would double-process the req.
- **How libuv handles it**: submit only special-cases hard failure: `if (result != 0 && WSAGetLastError() != WSA_IO_PENDING)` (src/win/poll.c:131); success (0) and pending both wait for the IOCP packet. uv\_\_msafd_poll maps STATUS_SUCCESS→0 / STATUS_PENDING→SOCKET_ERROR+WSA_IO_PENDING (src/win/winsock.c:526-546). Corollary: NEVER set skip-completion-port mode on the poll conduit handle.
- **History**: d7a71761; the corollary is why non-IFS-LSP detection gates that mode elsewhere (POLL-44).
- **Bun disposition**: must-port (uniform completion path; explicitly forbid SetFileCompletionNotificationModes on the AFD helper handle). Target: native AFD poll submit.

### [POLL-32] Closing an active handle: cancel by submitting a dummy EXCLUSIVE poll (CancelIoEx does not work here)

- **What Windows does**: the pending poll IRPs were issued through the peer socket handle; `CancelIoEx(watched_socket, overlapped)` doesn't match them (wrong file object), and 2012-era CancelIoEx was unreliable for AFD polls anyway. An Exclusive poll targeting the same socket forces them to complete (POLL-17).
- **How libuv handles it**: `uv__poll_close`: if reqs pending and fast mode, submit a poll on `handle->socket` itself with `Exclusive=TRUE, Timeout=INT64_MAX, Events=AFD_POLL_ALL`, dummy OVERLAPPED + dummy output buffer; WSA_IO_PENDING is success, other errors are returned (src/win/poll.c:533-571 — though uv_close ignores the return, src/win/handle.c:96). The cancel IRP itself is fire-and-forget: it may linger on the socket until the socket closes; nobody waits on it.
- **History**: original code had a CancelIoEx-if-available path + blocking cancel; 528123ad (Jun 2012) fixed bugs in the cancel (see POLL-33); 07f01752 (one day later, "fix hang when closing an active poll handle") DELETED the CancelIoEx path entirely, restored Exclusive=TRUE + INT64_MAX (a prior tweak to Exclusive=FALSE/Timeout=0 made the cancel complete itself without kicking anything → close hung), and made it non-blocking via the global dummy overlapped.
- **Bun disposition**: must-port the mechanism OR use NtCancelIoFileEx(peer_handle, &req->iosb) per IRP (wepoll/mio's way; fine on 1809+, avoids the lingering dummy IRP). If Exclusive-resubmit is kept, port it exactly — the three knobs (Exclusive, infinite timeout, ALL events) are each load-bearing. Target: native AFD poll close path.

### [POLL-33] Tagged-hEvent trick: set the low bit of OVERLAPPED.hEvent to suppress the IOCP completion packet

- **What Windows does**: documented NT behavior — if the OVERLAPPED's hEvent has its low-order bit set, the I/O manager does not queue a completion packet to the associated port (Win32 strips the bit before passing the real event to the kernel; at NT level the same is achieved by passing ApcContext=NULL).
- **How libuv handles it**: the close-time cancel uses a process-global `overlapped_dummy_` whose hEvent = `CreateEvent(...) | 1` built under uv_once; the event is intentionally manual-reset, initially-set, and never closed (src/win/poll.c:48-69). `uv__msafd_poll` implements the convention manually: tagged → strip bit, pass real event, ApcContext=NULL (no packet); untagged → ApcContext=overlapped (packet posted) (src/win/winsock.c:472-483). Without suppression the cancel's completion would arrive with an OVERLAPPED pointing at a static dummy that container_of would convert to a garbage req → crash.
- **History**: d7a71761 had a TYPO — `hEvent = event & 1` instead of `| 1` (hEvent became 0 or 1; no suppression). Fixed in 528123ad. A one-character bug that produced loop-corrupting stray packets.
- **Bun disposition**: must-port (whichever suppression spelling is used — tag bit at Win32 level or ApcContext=NULL at NT level — every fire-and-forget submission MUST suppress its packet, and the dispatch path should defensively ignore unknown OVERLAPPEDs anyway). Target: sys/windows NT submission helper + native AFD poll close.

### [POLL-34] The fire-and-forget cancel's OUTPUT buffer must be immortal — stack: corruption; per-handle heap: also wrong (reverted)

- **What Windows does**: IOCTL_AFD_POLL is METHOD_BUFFERED: the INPUT is copied into a system buffer at submit time (stack input is safe), but the OUTPUT buffer is written by the I/O manager AT COMPLETION TIME — which for the lingering cancel IRP can be arbitrarily later (when the socket finally closes), long after the submitting frame returned and even after the uv_poll_t was freed.
- **How libuv handles it**: output goes to a process-global static `afd_poll_info_dummy_` (src/win/poll.c:51, 72-74, used at 559-562); concurrent garbage writes into it are harmless by design. Stack input AFD_POLL_INFO remains OK (src/win/poll.c:534, 552-557).
- **History**: the saga: original code passed the stack struct as BOTH in and out → "sometimes causes stack corruption" — memorialized by test/test-poll-close-doesnt-corrupt-stack.c (0xDEADBEEF canary). User fix cd894521 (Dec 2014) malloc'd a 2-slot AFD_POLL_INFO per handle; Bert Belder REVERTED it 5 days later (152c35d5): "doesn't completely fix the issue, it just trades stack corruption for heap corruption which is less likely" (the heap block dies with the handle while the IRP may outlive the handle). Final fix 48d39345: split uv_msafd_poll into separate info_in/info_out params and aim info_out at the immortal static.
- **Bun disposition**: must-port — the single most instructive memory-safety lesson in this file: any buffer a pending IRP can write must outlive the IRP, and for unawaited IRPs the only safe lifetimes are 'static (or refcounted-until-completion). In Rust: a static `SyncUnsafeCell<AFD_POLL_INFO>` scratch, or NtCancelIoFileEx to avoid the lingering IRP entirely. Target: native AFD poll close path.

### [POLL-35] Close/endgame gating: the handle is only destroyed when BOTH req slots have drained

- **What Windows does**: each pending IRP holds kernel references to the req's OVERLAPPED memory; freeing the uv_poll_t (which embeds both reqs and both AFD_POLL_INFOs) while an IRP is pending = use-after-free by the kernel.
- **How libuv handles it**: `uv__poll_close` goes straight to endgame only if `submitted_events_1 == 0 && submitted_events_2 == 0`; otherwise it cancels (fast) or just waits (slow), and the LAST completing req triggers endgame from the tail of process_poll_req (`flags & UV_HANDLE_CLOSING && both submitted == 0 → uv__want_endgame`) (src/win/poll.c:541-548, 197-201, 398-402). Endgame asserts both are zero (src/win/poll.c:574-582). Cancelled/kicked completions during close are swallowed by the WSAEINTR rule (POLL-23) and the `handle->events==0` filters.
- **History**: d7a71761; this gating is why all the cancel machinery exists.
- **Bun disposition**: must-port (in Rust: the per-socket poll state must be owned/pinned until in-flight count reaches 0 — refcount or generation map, never Box::drop on close request). Target: native AFD poll lifecycle.

### [POLL-36] uv_poll_stop does NOT cancel the in-flight IRP — it only clears the event mask

- **What Windows does**: nothing forces you to cancel; a pending poll IRP just keeps watching.
- **How libuv handles it**: stop = `uv__poll_set(handle, 0, cb)` → `handle->events = 0; uv__handle_stop` — no AFD interaction (src/win/poll.c:494-497, 519-521). The pending IRP completes whenever the socket next has activity; the completion is filtered to nothing (`events &= handle->events`), the slot frees, no resubmit happens. Consequences carried by the design: (a) req memory stays pinned (handle can't be freed until close), (b) the docs promise "the fd can be safely closed immediately after uv_poll_stop" — works because the dangling IRP's LOCAL_CLOSE/CANCELLED completion is filtered/swallowed, (c) a stopped-then-restarted handle may reuse the still-pending IRP if the event set matches (`events & ~submitted == 0` → no new submission, src/win/poll.c:500-508).
- **History**: d7a71761.
- **Bun disposition**: must-port (lazy-cancel semantics are simpler AND required for the safe-close-after-stop contract; eager NtCancelIoFileEx on stop is acceptable too but the completion-filtering must exist regardless). Target: native AFD poll start/stop.

### [POLL-37] Two poll watchers on the same socket interfere — and Windows libuv cannot detect it

- **What Windows does**: Exclusive polls are matched per target socket (POLL-17): two independent watchers (two uv_poll handles, two loops, or another library doing AFD polls — even another process via duplicated handles) kick each other's IRPs in an endless cancel war → busyloop or starvation.
- **How libuv handles it**: it doesn't, on Windows: docs state "It is not okay to have multiple active poll handles for the same socket, this can cause libuv to busyloop or otherwise malfunction" (docs/src/poll.rst:21-23). Unix returns UV_EEXIST from the io_watchers table; test/test-poll-multiple-handles.c:75-82 skips that assertion on Windows: "We do not track handles in an O(1) lookupable way on Windows, so not checking that here."
- **History**: documented limitation since the feature; the test codifies the asymmetry.
- **Bun disposition**: must-port the constraint; should-port an actual guard (Bun's native loop can keep a base-socket→watcher map and return EEXIST like Unix — cheap and converts a busyloop into an error). Also avoid mixing Bun-native AFD polls and vendored-libuv uv_poll on the same socket during migration. Target: native AFD poll registration.

### [POLL-38] Slow path: select() on a system threadpool thread for non-MSAFD sockets

- **What Windows does**: sockets whose base provider isn't MSAFD (non-IFS LSPs, exotic providers) can't take AFD ioctls; the only portable readiness primitive left is select().
- **How libuv handles it**: `UV_HANDLE_POLL_SLOW` flag (src/uv-common.h:137) chosen at init when no peer socket (src/win/poll.c:462-468). Each submission runs `uv__slow_poll_thread_proc` via `QueueUserWorkItem(..., WT_EXECUTELONGFUNCTION)` — the WINDOWS system pool, NOT libuv's threadpool (src/win/poll.c:334-360); result posted back with PostQueuedCompletionStatus (src/win/req-inl.h:76-82). Same dual-req/mask bookkeeping as fast path (src/win/poll.c:364-403).
- **History**: d7a71761; unchanged since.
- **Bun disposition**: skip for Bun-native sockets (Bun creates its own sockets → always MSAFD; on registration failure return a clear error naming the provider). should-port ONLY if Bun's native poll must accept arbitrary NAPI-addon sockets without vendored libuv as backstop — revisit when vendored libuv is dropped. Record: skipping means LSP-wrapped sockets that fail POLL-12's unwrap get an error instead of degraded polling. Target: native AFD poll registration error path.

### [POLL-39] The 3-minute select() safety timeout — bounded hang when the user closes the socket under select

- **What Windows does**: select() on a socket that gets closesocket()'d mid-wait has undefined behavior: it may return WSAENOTSOCK promptly or may hang indefinitely.
- **How libuv handles it**: `timeout.tv_sec = 3 * 60` with comment "If select() hangs because the user closed the socket, we will at least not hang indefinitely" (src/win/poll.c:293-297). A timeout completes with 0 events → no callback → tail resubmits → effectively a 3-minute watchdog re-poll loop while idle.
- **History**: d7a71761; code comment only.
- **Bun disposition**: skip (with slow path). Lesson worth keeping anywhere Bun blocks a helper thread on a user-closable resource: always bound the wait. Target: n/a (general principle).

### [POLL-40] Slow path fd_set ABI hack and exceptfds→writable mapping

- **What Windows does**: winsock fd_set is `{u_int fd_count; SOCKET fd_array[FD_SETSIZE]}`; select() ignores its first (nfds) argument; a failed non-blocking connect is signaled via EXCEPTFDS, not writefds.
- **How libuv handles it**: `uv_single_fd_set_t {fd_count; fd_array[1]}` cast to fd_set\* — 1-slot sets relying on the {count, array} ABI prefix (src/win/poll.c:42-45, 298); efds populated only when UV_WRITABLE requested, and efds membership reported as UV_WRITABLE (src/win/poll.c:283-291, 315-323) — keeping connect-fail parity with AFD_POLL_CONNECT_FAIL (POLL-21).
- **History**: d7a71761.
- **Bun disposition**: skip (with slow path); the exceptfds→writable equivalence is worth a comment in the event-translation module since it explains WHY CONNECT_FAIL maps to writable. Target: n/a.

### [POLL-41] Latent upstream bug: slow-path select() error is recorded on poll_req_1 even when the failing req is poll_req_2

- **What Windows does**: n/a (pure logic bug).
- **How libuv handles it**: `SET_REQ_ERROR(&handle->poll_req_1, WSAGetLastError()); POST_COMPLETION_FOR_REQ(handle->loop, req);` (src/win/poll.c:299-303) — the error status is written to req_1's OVERLAPPED unconditionally while `req` (possibly req_2) is the one posted; req_2 then carries stale Internal status (likely 0 = success from zero-init) and stale InternalHigh event bits, and req_1's in-flight status got clobbered.
- **History**: present verbatim since d7a71761 (2012), confirmed via `git log -S` — never reported/fixed upstream; rarely hit because the second slot is only used during in-flight event-mask changes AND select must fail in that narrow window.
- **Bun disposition**: skip (slow path not ported) — recorded so nobody copies it; if Bun ever upstreams fixes to oven-sh/libuv, this is a freebie. Target: n/a.

### [POLL-42] Slow-path close cannot cancel: close_cb may stall up to 3 minutes

- **What Windows does**: there is no way to interrupt another thread's select() short of closing the socket (which the loop doesn't own).
- **How libuv handles it**: `uv__poll_close` for slow mode just returns with reqs outstanding (src/win/poll.c:547-548); endgame waits for the worker's POST (≤3 min via POLL-39). The loop keeps running but uv_run won't finish and process exit is delayed.
- **History**: d7a71761; inherent to the design.
- **Bun disposition**: skip (with slow path). Lesson: never build a cancellation-free blocking helper into handle close paths. Target: n/a.

### [POLL-43] uv\_\_msafd_poll plumbing: dynamically-resolved NtDeviceIoControlFile, ApcContext routing, dead blocking branch

- **What Windows does**: NtDeviceIoControlFile is an ntdll export (stable since NT, not in any import lib SDKs encourage); the ApcContext parameter is what the IOCP returns as lpOverlapped.
- **How libuv handles it**: resolved once via GetProcAddress(ntdll) at startup, fatal if missing (src/win/winapi.c:94-98; RtlNtStatusToDosError likewise 88-92); uv\_\_msafd_poll passes apc_context=overlapped (or NULL when tagged, POLL-33) (src/win/winsock.c:496-505). It also retains a blocking mode (overlapped==NULL: create event, WaitForSingleObject INFINITE, read iosb.Status) at src/win/winsock.c:485-524 — currently DEAD CODE: all callers pass an overlapped.
- **History**: 19aca7a7. The blocking branch was used by ancient callers; nobody removed it.
- **Bun disposition**: must-port the resolution + ApcContext convention (Rust: link ntdll directly via windows-sys/raw externs — no GetProcAddress needed on 1809+). Skip the blocking branch (dead). Target: sys/windows NT bindings.

### [POLL-44] The NTSTATUS→winsock error table — translate completion status yourself, with the FACILITY_NTWIN32 escape hatch

- **What Windows does**: AFD completions carry NTSTATUS, not WSA errors. Some NTSTATUS values are themselves wrapped Win32 errors (facility 0x7 = FACILITY_NTWIN32, value in low 16 bits). RtlNtStatusToDosError exists but loses winsock-specific distinctions libuv wants.
- **How libuv handles it**: hand-maintained `uv__ntstatus_to_winsock_error` (src/win/winsock.c:139-253): STATUS_CANCELLED/REQUEST_ABORTED→WSAEINTR (load-bearing for POLL-23); resource-exhaustion family→WSAENOBUFS; reset family (incl. STATUS_PORT_UNREACHABLE, STATUS_HOPLIMIT_EXCEEDED)→WSAECONNRESET; STATUS_INVALID_HANDLE/OBJECT_TYPE_MISMATCH→WSAENOTSOCK; default: if `(status & (FACILITY_NTWIN32<<16)) == (FACILITY_NTWIN32<<16)` AND a severity bit is set, extract `status & 0xffff` as the original Win32 error; else WSAEINVAL.
- **History**: 6622c35b introduced the table; 0ded5d29 (2011) fixed the default clause — the original `status & ((FACILITY_NTWIN32<<16) | ERROR_SEVERITY_ERROR)` was a nonzero-AND (true for almost ANY error status), misclassifying real NTSTATUS codes as wrapped Win32 errors; 261d792a added HOPLIMIT_EXCEEDED→WSAECONNRESET (UDP TTL-exceeded ICMP); f326820f (2013) fixed address errors (STATUS_TOO_MANY_ADDRESSES→WSAEADDRINUSE, STATUS_CONFLICTING_ADDRESSES→WSAEADDRNOTAVAIL).
- **Bun disposition**: must-port (table + the masked-comparison lesson from 0ded5d29: facility checks need ==, not &). Bun likely already has NTSTATUS translation in sys — extend it with the winsock rows rather than forking. Target: sys/windows error translation, cross-ref: TCP/UDP.

### [POLL-45] Non-IFS LSP detection at startup, fail-safe defaults, and no aborting in weird environments

- **What Windows does**: non-IFS LSPs return socket pseudo-handles that are NOT file-system handles; kernel fast paths (skip-completion-port, etc.) silently malfunction on them. Detection: create a throwaway socket per family, read WSAPROTOCOL_INFOW.dwServiceFlags1 & XP1_IFS_HANDLES. Detection itself can fail in sandboxes/safe mode/no-IPv6 systems.
- **How libuv handles it**: `uv__winsock_init` sets `uv_tcp_non_ifs_lsp_ipv4/6 = 1` (assume worst) and clears to 0 only when the probe PROVES the default chain is IFS (src/win/winsock.c:103-135); probe failure leaves the conservative default instead of aborting; safe-mode (`GetSystemMetrics(SM_CLEANBOOT) == 1`) skips winsock init entirely so non-network apps still start (src/win/winsock.c:94-95). Consumers: tcp.c gates SetFileCompletionNotificationModes(FILE_SKIP_COMPLETION_PORT_ON_SUCCESS|FILE_SKIP_SET_EVENT_ON_HANDLE) on !non_ifs_lsp (src/win/tcp.c:181-193) and uses SIO_BASE_HANDLE before CancelIo when LSPs present (src/win/tcp.c:1468-1488).
- **History**: c0e70448 (2012, "avoid IOCP short-circuit if non-ifs lsps are detected" — the original Node-on-AV-machines bug); e1fad5a3 (2018, #1425) removed the uv_fatal_error on detection failure and flipped to fail-safe defaults; af31d014 (2019, #2205) added the safe-mode skip.
- **Bun disposition**: should-port (cross-ref: TCP). For poll specifically the per-socket GUID check (POLL-07) subsumes it; but Bun's TCP/UDP fast paths on Windows need this exact global probe + fail-safe-default pattern, and startup must not die in safe mode/AppContainer. Target: native winsock init, cross-ref: TCP/UDP/loop.

### [POLL-46] Adjacent AFD usage: IOCTL_AFD_RECEIVE(\_DATAGRAM) workarounds — MSAFD-only, same plumbing, same caveats

- **What Windows does**: with SetFileCompletionNotificationModes active, WSARecv/WSARecvFrom "does not reliably indicate whether we can expect a completion package" when the buffer is smaller than the datagram (zero-read pattern) — a winsock-layer bug bypassed by issuing the AFD receive ioctl directly. STATUS_RECEIVE_PARTIAL/EXPEDITED variants must be re-mapped to MSG_PARTIAL/MSG_OOB flags manually.
- **How libuv handles it**: `uv__wsarecv_workaround`/`uv__wsarecvfrom_workaround` (src/win/winsock.c:256-460) with the explicit caveat comment: "requires the user to use the default msafd driver, doesn't work when other LSPs are stacked on top" (src/win/winsock.c:266-270); same tagged-hEvent/ApcContext and iosb conventions as poll.
- **History**: 51e9dbc2 (2011, "Work around windows udp bug, allow zero reads").
- **Bun disposition**: cross-ref: UDP area owns this; listed here because it shares every NT-call convention with poll (POLL-29/30/33/43) and proves those conventions generalize. Disposition for poll area: skip (owned elsewhere). Target: UDP receive path.

### [POLL-47] Wine: IOCTL_AFD_POLL exists in modern Wine precisely because libuv/wepoll use it; ancient Wine needed a GQCS fallback

- **What Windows does**: n/a — Wine reimplements AFD. Wine ≥6.x's winsock rewrite implements IOCTL_AFD_POLL and the MSAFD provider GUIDs specifically for wepoll/libuv/node compatibility; Wine pre-2018 lacked GetQueuedCompletionStatusEx entirely.
- **How libuv handles it**: poll.c needs nothing Wine-specific today. Loop-level history: fd8d212a removed the GetQueuedCompletionStatus(non-Ex) poller ("all supported Windows have Ex"), 153ea114 partially reverted it to "restore partial support for using libuv under Wine"; the current tree is GQCSEx-only again (src/win/core.c:466-471) since Wine gained Ex support.
- **History**: fd8d212a (#1858) / 153ea114 (#1963, 2018).
- **Bun disposition**: should-port awareness only: target GQCSEx + IOCTL_AFD_POLL freely (modern Wine handles both), but when debugging Wine reports, remember Wine's AFD is a reimplementation — PollState edge cases (POLL-04/26 timing) may differ. cross-ref: LOOP. Target: documentation/comment in loop module.

### [POLL-48] AFD event bit definitions come from the DDK, not the SDK — hand-define all 11, use only 7

- **What Windows does**: AFD*POLL*\* bits (RECEIVE=0x1, RECEIVE_EXPEDITED=0x2, SEND=0x4, DISCONNECT=0x8, ABORT=0x10, LOCAL_CLOSE=0x20, CONNECT=0x40, ACCEPT=0x80, CONNECT_FAIL=0x100, QOS=0x200, GROUP_QOS=0x400) are not in user-mode SDK headers.
- **How libuv handles it**: defined in src/win/winsock.h:116-140 with AFD_NUM_POLL_EVENTS=11 and AFD_POLL_ALL=(1<<11)-1. libuv requests/consumes only RECEIVE, SEND, DISCONNECT, ABORT, LOCAL_CLOSE, ACCEPT, CONNECT_FAIL; AFD_POLL_ALL appears only in the cancel poll (POLL-32). RECEIVE_EXPEDITED (POLL-20), CONNECT, QOS, GROUP_QOS unused. Bit values match wepoll/ReactOS exactly.
- **History**: 51e9dbc2/d7a71761.
- **Bun disposition**: must-port the 7 used bits + ALL mask with values verified against wepoll; define the rest for documentation. Target: sys/windows AFD constants.

### [POLL-49] events/submitted/mask fields are single bytes; UV event bits are 1/2/4/8

- **What Windows does**: n/a — internal representation.
- **How libuv handles it**: UV_READABLE=1, UV_WRITABLE=2, UV_DISCONNECT=4, UV_PRIORITIZED=8 (include/uv.h:911-916); all five bookkeeping fields are `unsigned char` (include/uv/win.h:541-545), so the whole level-trigger state machine is 5 bytes — masks compose with plain bitwise ops, and the `events & ~(submitted_1|submitted_2)` resubmit test (src/win/poll.c:194, 395, 502) is the single source of truth for "do we need another IRP".
- **History**: d7a71761.
- **Bun disposition**: must-port the derived-not-stored principle: "needs re-arm" is always computed from (wanted, in-flight-1, in-flight-2), never cached as a flag. Exact bit values only matter at the libuv-compat NAPI boundary. Target: native AFD poll per-socket state.

---

## Tally (each entry counted once, by primary disposition)

- Total quirks: 49
- must-port: 39 (POLL-01..11, 13..19, 21..37, 43, 44, 48, 49)
- should-port: 3 (POLL-12 Komodia/SIO_BSP_HANDLE_POLL fallback, POLL-45 non-IFS LSP probe [cross-ref TCP], POLL-47 Wine awareness [cross-ref LOOP])
- skip: 7 (POLL-20 UV_PRIORITIZED never delivered, POLL-38 select-thread slow path, POLL-39 3-minute select timeout, POLL-40 fd_set ABI hack, POLL-41 upstream req_1 error-slot bug, POLL-42 slow-close stall, POLL-46 AFD receive workarounds [owned by UDP area])

Secondary notes that do not change the counts: POLL-14 carries a should-port half (CRT-fd
assert suppression, NAPI-only), POLL-37 carries a should-port half (EEXIST same-socket guard),
POLL-43 carries a skip half (dead blocking branch of uv\_\_msafd_poll).
