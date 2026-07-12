# Consumer-Requirements Inventory — Bun.udpSocket over uSockets UDP (for Rust rewrite of the uSockets core)

Scope inspected: `src/uws_sys/udp.rs` (FFI surface), `src/runtime/socket/udp_socket.rs` (JS-facing UDPSocket), `src/js/node/dgram.ts` (node:dgram layer), `src/runtime/node/node_net_binding.rs`, plus the C side (`packages/bun-usockets/src/udp.c`, `loop.c`, `bsd.c`, `internal/internal.h`, `libusockets.h`) to pin exact semantics the new crate must reproduce.

**Note:** `src/runtime/node/node_net_binding.rs` contains **zero** UDP/dgram content (grep for `udp|dgram` returns nothing). node:dgram is built entirely in JS (`src/js/node/dgram.ts`) directly on top of `Bun.udpSocket` and two `$newRustFunction` hooks.

---

## 1. FFI surface consumed (`src/uws_sys/udp.rs`)

Every extern the new crate must expose, with the Rust wrapper anchor:

| C symbol | Rust wrapper | Anchor |
|---|---|---|
| `us_create_udp_socket(loop, data_cb, drain_cb, close_cb, recv_error_cb, host, port, options, err*, user)` | `Socket::create` | udp.rs:17–48, extern udp.rs:142–153 |
| `us_udp_socket_send(socket, payloads**, lengths*, addresses**, num) -> int` | `Socket::send(&[*const u8], &[usize], &[*const c_void])` | udp.rs:50–67, extern udp.rs:156–162 |
| `us_udp_socket_user` | `Socket::user() -> *mut c_void` | udp.rs:69–71 |
| `us_udp_socket_bound_port` (host byte order) | `Socket::bound_port` | udp.rs:74–76 |
| `us_udp_socket_bound_ip(buf, &mut len)` | `Socket::bound_ip` | udp.rs:78–81 |
| `us_udp_socket_remote_ip(buf, &mut len)` | `Socket::remote_ip` | udp.rs:83–86 |
| `us_udp_socket_close` | `Socket::close` | udp.rs:88–90 |
| `us_udp_socket_connect(hostname, port) -> int` | `Socket::connect` | udp.rs:92–95 |
| `us_udp_socket_disconnect -> int` | `Socket::disconnect` | udp.rs:97–99 |
| `us_udp_socket_set_broadcast(int) -> int` | `set_broadcast(bool)` | udp.rs:101–103 |
| `us_udp_socket_set_ttl_unicast(int) -> int` | `set_unicast_ttl(i32)` | udp.rs:105–107 |
| `us_udp_socket_set_ttl_multicast(int) -> int` | `set_multicast_ttl(i32)` | udp.rs:109–111 |
| `us_udp_socket_set_multicast_loopback(int) -> int` | `set_multicast_loopback(bool)` | udp.rs:113–115 |
| `us_udp_socket_set_multicast_interface(&sockaddr_storage) -> int` | udp.rs:117–119 |
| `us_udp_socket_set_membership(&addr, Option<&iface>, drop) -> int` | udp.rs:121–128; `Option<&T>` null-niche note udp.rs:176–185 |
| `us_udp_socket_set_source_specific_membership(&src, &group, Option<&iface>, drop) -> int` | udp.rs:130–138, extern udp.rs:186–192 |
| `us_udp_packet_buffer_peer(buf, i) -> *mut sockaddr_storage` | `PacketBuffer::get_peer` | udp.rs:201–209 |
| `us_udp_packet_buffer_payload` + `us_udp_packet_buffer_payload_length` | `PacketBuffer::get_payload -> &mut [u8]` | udp.rs:211–222 |
| `us_udp_packet_buffer_truncated -> int` | `PacketBuffer::get_truncated -> bool` | udp.rs:224–226 |

Not consumed by Rust (exists in C, may be dropped or kept optional): `us_udp_packet_buffer_local_ip` (udp.c:27), ECN accessor (commented out, udp.c:23–25).

Opaque types: `Socket` and `PacketBuffer` are `bun_opaque::opaque_ffi!` ZSTs (udp.rs:11–14, 195–198); registered in `src/uws_sys/lib.rs:171` (`us_udp_socket_t`, `us_udp_packet_buffer_t`) and mounted at lib.rs:386–387.

Loop integration hook consumed: `src/uws_sys/InternalLoopData.rs:44` — `pub closed_udp_head: *mut udp::Socket` (Rust reads/knows this field layout of `us_internal_loop_data`).

---

## 2. Create / bind

- **Call site:** udp_socket.rs:577–588 — `uws::udp::Socket::create(this.loop_, on_data, on_drain, on_close, on_recv_error, hostname_z.as_ptr(), config.port, config.flags, Some(&mut err), this_ptr.cast::<c_void>())`. Loop obtained via `uws::Loop::get()` (udp_socket.rs:514) — the singleton JS-thread loop.
- **Host** is a NUL-terminated string that goes through `getaddrinfo(AI_PASSIVE, AF_UNSPEC, SOCK_DGRAM)`, IPv6 result preferred over IPv4 (bsd.c:1417–1456). **Bind happens inside create** (bsd.c:1540).
- **Flags** (`options: c_int`) — Bun.udpSocket exposes raw `flags` int (udp_socket.rs:326–330 validate_int32); node:dgram composes them at dgram.ts:302–314 from the enum mirrored at dgram.ts:33–41:
  - `LISTEN_DISALLOW_REUSE_PORT_FAILURE = 32` (always set by dgram)
  - `LISTEN_REUSE_ADDR = 16` ← `options.reuseAddr`
  - `SOCKET_IPV6_ONLY = 8` ← `options.ipv6Only`
  - `LISTEN_REUSE_PORT = 4` ← `options.reusePort`
  - (values from `packages/bun-usockets/src/libusockets.h:110–130`)
- **Side-effect socket options set unconditionally in `bsd_create_udp_socket`** the rewrite must keep: `bsd_set_reuse` per flags (bsd.c:1461), `IPV6_V6ONLY` per flag (bsd.c:1475–1481), `IPV6_RECVPKTINFO`/`IP_PKTINFO`/`IP_RECVDSTADDR` (bsd.c:1491–1500), ECN `IPV6_RECVTCLASS`/`IP_RECVTOS` (bsd.c:1503–1507), Windows `SIO_UDP_CONNRESET`/`SIO_UDP_NETRESET` off (bsd.c:1509–1521), Linux `IP_RECVERR`/`IPV6_RECVERR` (bsd.c:1523–1537).
- **Error out-param:** `*err` receives `-gai_result` for DNS failure (negative EAI code, bsd.c:1435), else errno/WSAGetLastError; consumer maps it at udp_socket.rs:596–621 into a SystemError with `message = "bind {code} {hostname}"` and an `address` property, else generic `"Failed to bind socket"`.
- Poll is created with `sizeof(us_udp_socket_t)`, started `READABLE | WRITABLE` (udp.c:170–180); **poll-start failure returns null with errno preserved in `*err`** (udp.c:174–180).
- **Bound port cached at create time** (`udp->port`, udp.c:186–188; internal.h struct comment 352–355) — `bound_port` is a field read, not a syscall.
- Kernel buffer sizes: not settable — dgram.ts:216 `bufferSize` hard-returns `1 << 19` ("common buffer for all sockets is fixed at 512KiB").

## 3. Ext data / ref storage (JS object wiring)

- **No ext area is used** — `ext_size = 0`, "There is no udp socket context, only user data" (udp.c:167, 191–193). The `user: *mut c_void` slot holds a raw `*mut UDPSocket` (heap `Box`), set at create (udp_socket.rs:587) and recovered in every callback via `UDPSocket::from_uws` (udp_socket.rs:497–504): `user()` → `unsafe { &*user.cast::<UDPSocket>() }`. Doc comment (udp_socket.rs:490–496): user pointer "remains live until `on_close` (uws guarantees no callback after close)".
- **UDPSocket struct** (udp_socket.rs:465–483): `socket: Cell<Option<*mut uws::udp::Socket>>`, `loop_: *mut uws::Loop`, `global_this: BackRef<JSGlobalObject>`, `this_value: JsCell<JsRef>` (strong→weak JS wrapper handle), `jsc_ref: JscRef`, `poll_ref: JsCell<KeepAlive>` (event-loop keepalive), `closed: Cell<bool>` — field doc: `/// if marked as closed the socket pointer may be stale` (udp_socket.rs:479), `connect_info: Cell<Option<ConnectInfo>>` (just the connected port, udp_socket.rs:440–443).
- JS class: `sockets.classes.ts:332–...` — `UDPSocket`, `noConstructor`, `sharedThis: true`, `finalize: true`, GC-tracked `values: ["on_data", "on_drain", "on_error"]`, cached getters `hostname/port/address/remoteAddress/binaryType`. Cached accessors declared at udp_socket.rs:452–458.
- `this_value.set_strong(...)` after wrapper creation (udp_socket.rs:566–567); `poll_ref.ref_()` keeps the event loop alive (udp_socket.rs:652). `ref`/`unref` methods toggle `poll_ref` (udp_socket.rs:1551–1577); `ref` is a no-op if closed.
- Entry point registered as `Bun.udpSocket` via `BunObject.rs:363`; returns `JSPromise::resolved_promise_value(global, this_value)` (udp_socket.rs:653–656).

## 4. connect / disconnect

- At-create connect: udp_socket.rs:624–647 — `connect(address_z, port as u32)`; nonzero return is classified: POSIX `-1` → errno SystemError via `errno_sys` (udp_socket.rs:630), negative EAI codes → c-ares style DNS error with syscall `"connect"` + hostname (udp_socket.rs:634–643). The Windows errno-vs-Winsock subtlety is documented at udp_socket.rs:40–46.
- Port 0 sentinel: connect port outside 1..=65535 is coerced to 0 (udp_socket.rs:424–428, 1772–1776) and passed through.
- Post-hoc `jsConnect` (udp_socket.rs:1738–1791, used by dgram via `$newRustFunction("udp_socket.rs", "UDPSocket.jsConnect", 2)` at dgram.ts:398): rejects already-connected/closed; `connect(...) == -1` → throw; on success sets `connect_info` and **clears the cached `address`/`remoteAddress` getter memos** (udp_socket.rs:1787–1788).
- `jsDisconnect` (udp_socket.rs:1794–1821; dgram.ts:430–437): `disconnect() == -1` → throw; clears `connect_info`. C side: `bsd_disconnect_udp_socket` = connect to AF_UNSPEC.
- C `us_udp_socket_connect`/`disconnect` are pure fd ops (udp.c:126–132); note the `connected` bitfield in `us_udp_socket_t` (internal.h:357) is set nowhere by these — the Rust layer tracks connectedness itself via `connect_info`.

## 5. send / sendMany (batching)

- **Single send** (udp_socket.rs:1331–1431): connected socket takes 1 arg (payload only, `addr_ptr = null`); unconnected takes exactly 3 `(payload, port, address)`. Address resolved **before** payload capture — safety comment udp_socket.rs:1369–1375: "`parseAddr` calls `port.coerceToInt32()` / `address.toBunString()` which can run user JS that detaches the payload's ArrayBuffer (`.transfer(n)`) or closes this socket. Doing this first means no JSC safepoint sits between capturing `payload.ptr` and handing it to `socket.send`". Calls `send(&[ptr], &[len], &[addr_ptr])`; returns `JSValue::from(res > 0)` (bool: sent vs dropped-for-backpressure).
- **sendMany** (udp_socket.rs:1116–1329): flat JS array; connected → each element is a payload; unconnected → triples `(payload, port, address)`, length must be divisible by 3 (udp_socket.rs:1197–1199). Two-phase design against GC/detach UAF — comments udp_socket.rs:1122–1134 ("Root every payload JSValue in a MarkedArgumentBuffer … phase 2 borrows byte slices only once no more user JS sits between capture and `socket.send`") and udp_socket.rs:1187–1194 (cache `connected` before user JS: mid-loop connect flip "producing out-of-bounds writes … or uninitialized slots"). Detached buffers become a **valid static empty slice**, not the zero-length sentinel: "its `.ptr` is a zero-length sentinel which the kernel rejects with EFAULT even though `iov_len == 0`" (udp_socket.rs:1302–1306). Returns packet count as a JS number (udp_socket.rs:1328).
- **C send semantics the rewrite must match** (udp.c:47–73): loops `bsd_udp_setup_sendbuf` (chunks into loop-shared `LIBUS_SEND_BUFFER_LENGTH = 1<<14` send_buf, libusockets.h:62) + `bsd_sendmmsg(fd, buf, MSG_DONTWAIT)`; returns negative on error, else count of packets actually sent; **on partial send it re-arms `WRITABLE` on the poll so `on_drain` fires later** (udp.c:66–69). `num == 0` → returns 0. `addresses[i] == NULL` means "connected, no destination" per-packet.
- Error mapping: `get_us_error::<true>` (udp_socket.rs:1829–1860) — POSIX: only `rc == -1` is an errno failure (udp_socket.rs:31–46 doc); Windows: `res >= 0` success, else prefer `WSAGetLastError()` (then reset it to 0) over CRT errno (udp_socket.rs:1830–1853).
- node:dgram (dgram.ts:562–689): coalesces buffer lists via `Buffer.concat` (dgram.ts:661–663), calls `socket.send(data, port, ip)` or `socket.send(data)` (dgram.ts:665–669); callback gets `sent = success ? data.byteLength : 0` (dgram.ts:680–684) — dgram never uses `sendMany` and never uses the drain event.

## 6. recv callback (mmsg buffers)

- **Callback shape:** `extern "C" fn(*mut Socket, *mut PacketBuffer, packets: c_int)` — `on_data` udp_socket.rs:124–275.
- C dispatch (loop.c:846–884): on READABLE, loop `{ setup recvbuf over loop-shared recv_buf (LIBUS_RECV_BUFFER_LENGTH = 512 KiB, libusockets.h:59); bsd_recvmmsg(MSG_DONTWAIT); on_data(u, &recvbuf, n) }` until 0/EAGAIN or socket closed. Batch size `LIBUS_UDP_RECV_COUNT` = `LIBUS_RECV_BUFFER_LENGTH / LIBUS_UDP_MAX_SIZE` = 512 KiB / 64 KiB = **8** per batch (bsd.h:49,64; Windows = 1, plain recvfrom, bsd.c:130–149; macOS uses `recvmsg_x` or per-msg `recvmsg` fallback, bsd.c:151–170). Each datagram slot is 64 KiB (`LIBUS_UDP_MAX_SIZE`), per-slot `sockaddr_storage` name + control buf (bsd.c:186–200); truncation flag per packet (bsd.c:314–323).
- **PacketBuffer is loaned only for the callback duration** — udp.rs:201–222 SAFETY comments ("C-owned packet buffer, which is exclusively loaned to the data callback for its duration").
- Rust consumer loop (udp_socket.rs:144–272): per packet — **close recheck**: "A prior iteration's callback (or its error handler) may have closed this socket; stop dispatching the rest of the recvmmsg batch so no 'data' fires after 'close'. Matches libuv's per-datagram recheck." (udp_socket.rs:146–151); peer decoded by `ss_family` (AF_INET/AF_INET6 via `ares ntop`, port via `ntohs`, IPv6 `scope_id` appended as `%ifname` or `%id`, udp_socket.rs:161–223); unknown family or unparsable/port-0 packets skipped (udp_socket.rs:183–192); `flags = { truncated }` object (udp_socket.rs:228–229); payload converted per `binaryType` (Buffer/Uint8Array/ArrayBuffer — a **copy** out of the shared recv buffer, udp_socket.rs:231–243); JS callback signature `(socket, payload, port, addressString, flags)` (udp_socket.rs:253–263); exceptions routed to `call_error_handler`; event loop `enter()/exit()` per packet (udp_socket.rs:225–226, 269).
- node:dgram maps this to `'message'` with `{ port, address, size: data.length, family }` (dgram.ts:319–333).

## 7. recv-error callback

- `extern "C" fn(*mut Socket, errno: c_int)` — `on_recv_error` udp_socket.rs:88–100 with comment: "Only called on Linux via IP_RECVERR — loop.c guards the recv-on-error path with #if defined(__linux__) to preserve the pre-existing close-on-error behavior on kqueue/Windows (where an error event is a fatal socket condition, not a drainable error queue). Builds a SystemError from the ICMP errno (ECONNREFUSED, EHOSTUNREACH, ENETUNREACH, EMSGSIZE, ...) and dispatches through the 'error' handler."
- C contract (internal.h:345–348): "Called when recvmmsg returns an error (other than EAGAIN). The socket is NOT closed — caller decides whether to close."
- Loop behavior to reproduce (loop.c:808–844, 899–913): Linux drains `MSG_ERRQUEUE` extracting `sock_extended_err.ee_errno`, socket stays open; residual EPOLLERR closes the socket **only** if no error was surfaced and recv wasn't EAGAIN-only; non-Linux: any error event → `us_udp_socket_close`.

## 8. drain callback / backpressure

- `extern "C" fn(*mut Socket)` — `on_drain` udp_socket.rs:102–122: fetches cached JS `drain` handler, calls it as `(socket)`; errors → error handler.
- Semantics: `send` returning fewer packets than requested (or bool `false` for single send at the JS level) is the backpressure signal; uSockets arms WRITABLE on partial send (udp.c:66–69). On the writable event, loop.c:886–897 **clears WRITABLE before invoking on_drain** ("Clear WRITABLE before on_drain so a callback that re-arms it … keeps the re-arm. We still default to one-shot drain semantics… Not gated on !error: a queued ICMP error must not leave WRITABLE armed (level-triggered EPOLLOUT + EPOLLERR would spin the loop)"), then checks `u->closed` after the callback.
- There is **no internal send queue** — unsent packets are dropped from uSockets' perspective; JS is expected to retry from `drain`. node:dgram ignores drain entirely (its only queue is the pre-bind queue, dgram.ts:485–507).

## 9. Socket options

All return raw setsockopt rc, mapped via `get_us_error::<true>` (Windows: `res >= 0` ok; note comment udp_socket.rs:1832–1833: "setsockopt returns 0 on success, but errnoSys considers 0 to be failure on Windows"):

- `setBroadcast(bool)` — udp_socket.rs:689–731 → SO_BROADCAST (bsd.c:399). EBADF thrown if `closed` **or** `socket == None`.
- `setTTL(n)` / `setMulticastTTL(n)` — udp_socket.rs:1050–1114 via fn-pointer `set_any_ttl` (takes `fn(&mut uws::udp::Socket, i32) -> c_int` — udp_socket.rs:1082). Returns the ttl number.
- `setMulticastLoopback(bool)` — udp_socket.rs:733–779; note Windows race comment udp_socket.rs:758–761: "On Windows we can observe `closed=false && socket=None` here (panic seen in test-dgram-multicast-loopback.js). Throw EBADF … instead of panicking."
- `setMulticastInterface(addr)` — udp_socket.rs:994–1048; zero-init `sockaddr_storage` rationale udp_socket.rs:1018–1024 ("`parse_addr` only writes the leading sockaddr_in/in6 prefix (≤28 bytes) … `assume_init()` … is UB"). Returns TRUE/FALSE.
- `addMembership`/`dropMembership` — udp_socket.rs:781–868; group addr parsed with port 0, optional interface addr, family-mismatch check (udp_socket.rs:834–837); `drop: bool` flag selects join/leave.
- `addSourceSpecificMembership`/`dropSourceSpecificMembership` — udp_socket.rs:870–992 (source, group, optional iface; two family checks).
- Address parsing helper `parse_addr` (udp_socket.rs:1433–1549): inet_pton v4 then v6; IPv6 zone `%<name>` via `if_nametoindex` on POSIX, numeric zone on Windows (udp_socket.rs:1474–1525); "an invalid Scope gets turned into #0 (default selection)" (udp_socket.rs:1522–1524); ports outside 1..=65535 → 0.
- node:dgram wrappers at dgram.ts:759–828 (setBroadcast/setTTL/setMulticastTTL/setMulticastLoopback/setMulticastInterface/addMembership; addMembership auto-binds first, dgram.ts:825–826).

## 10. Getters / introspection

- `port` getter — `bound_port()` (udp_socket.rs:1631–1641), undefined if closed/no socket.
- `address` getter — `bound_ip(buf[64], &mut len)` + `bound_port()` → `SocketAddress` DTO (udp_socket.rs:1651–1672). C fills via `getsockname` and sets `*length = 0` when buffer too small (udp.c:79–87).
- `remoteAddress` getter — `remote_ip` + the **cached connect port** (not getpeername port) (udp_socket.rs:1674–1692).
- `hostname`, `binaryType`, `closed` getters — udp_socket.rs:1626–1702.
- `reload(options)` — swaps handlers/config only, no us_ call (udp_socket.rs:1598–1619).

## 11. Close lifecycle + UAF-relevant comments (QUOTED)

- JS `close()` (udp_socket.rs:1579–1596): takes the pointer out of the Cell first, then:
  > "`(*socket).close()` SYNCHRONOUSLY invokes `on_close` (udp.c:110 `s->on_close(s)`), which re-derives `&UDPSocket` from the uws user pointer. R-2: with `&self` + `Cell`/`JsCell` the sibling shared borrow is sound; the (idempotent) downgrade is hoisted because `on_close` repeats it." (udp_socket.rs:1585–1589)
- `on_close` (udp_socket.rs:80–86): sets `closed = true`, disables `poll_ref`, downgrades `this_value` (strong→weak so GC can collect the wrapper), nulls `socket`.
- C close (udp.c:103–112): `us_poll_stop`, `bsd_close_socket`, `closed = 1`, push onto `loop->data.closed_udp_head`, **then synchronously** `s->on_close(s)`. Deferred free: `us_internal_free_closed_sockets` sweeps `closed_udp_head` with `us_poll_free` (loop.c:370–375) — so the `us_udp_socket_t` memory stays valid through end-of-iteration (Rust reads `closed_udp_head` via InternalLoopData.rs:44).
- Creation error-path guard (udp_socket.rs:526–551), quoting the ordering hazard:
  > "Hoist before `(*socket).close()`: that call SYNCHRONOUSLY re-enters `on_close` (udp.c `s->on_close(s)`), which re-derives `&UDPSocket` from the uws user pointer. `downgrade()` is idempotent (on_close repeats it), so ordering is unobservable." (udp_socket.rs:542–545)
  and: "Release the strong reference so the JS wrapper can be garbage collected, which will in turn call finalize() to free this struct. Without this, failed config parsing or bind would leave the wrapper pinned forever by the Strong handle and leak." (udp_socket.rs:528–531)
- GC finalize → `deinit` (udp_socket.rs:1704–1733), quoting the VM-shutdown UAF/leak note:
  > "VM-shutdown path: `lastChanceToFinalize` can finalize the wrapper while the underlying poll is still open (the Strong in `this_value` kept it GC-rooted until now). Close it so the `us_udp_socket_t` lands on `closed_udp_head` for the post-destruct `drain_closed_sockets()` sweep instead of leaking. `on_close` re-derives `&UDPSocket` from the uws user pointer (= `this`, still live) and only touches `Cell`/`JsCell` fields; `this_value` is already `Finalized` so its `downgrade()` is a no-op." (udp_socket.rs:1716–1723)
- `from_uws` invariant: "the user pointer was set to the heap-allocated `UDPSocket` … and remains live until `on_close` (uws guarantees no callback after close)" (udp_socket.rs:490–496).
- Batch-dispatch close recheck quoted in §6 (udp_socket.rs:146–150).
- node:dgram close: dgram.ts:696–712 — `state.handle.socket?.close(); state.handle = null;` then `'close'` emitted next tick; pre-bind close is queued (dgram.ts:702–704).

## 12. Loop integration summary

- One loop-global recv buffer (512 KiB) and send buffer (16 KiB) shared by all UDP sockets — `loop->data.recv_buf` / `send_buf` (loop.c:850, udp.c:51). Data callback must fully consume/copy before returning.
- Poll type `POLL_TYPE_UDP`, started `READABLE|WRITABLE` (udp.c:171–173); dispatch in `us_internal_dispatch_ready_poll` case at loop.c:802–915.
- Deferred free list `closed_udp_head` (see §11); guarantees: no callbacks after close, memory valid until sweep.
- Rust side keeps the JS event loop alive via `KeepAlive`/`poll_ref`, not via the uSockets poll (udp_socket.rs:652, 1551–1577).

## 13. Migration notes — exact `Udp` API the new Rust crate must expose

```rust
// Handle: heap-stable address (self-linked into closed list), usable as *mut for user-data backref.
pub struct UdpSocket { /* poll, callbacks, user, loop, cached_port: u16, closed: bool, connected: bool, next */ }

impl UdpSocket {
    // create+bind. host: NUL-terminated (getaddrinfo, IPv6-preferred, AI_PASSIVE).
    // flags bitor of: EXCLUSIVE_PORT=1, REUSE_PORT=4, IPV6_ONLY=8, REUSE_ADDR=16,
    //                 DISALLOW_REUSE_PORT_FAILURE=32.
    // err out-param: 0 ok, -EAI on DNS failure, errno/WSA otherwise. Returns null on failure.
    // Must set: reuse opts, IPV6_V6ONLY, PKTINFO, RECVTCLASS/RECVTOS, Linux IP_RECVERR(+v6),
    //           Win SIO_UDP_CONNRESET/NETRESET off. Cache bound port at create.
    pub fn create(loop_, on_data, on_drain, on_close, on_recv_error,
                  host: *const c_char, port: u16, flags: i32,
                  err: Option<&mut i32>, user: *mut c_void) -> *mut UdpSocket;

    // sendmmsg batch; addresses[i] == null → connected send. Returns count sent (may be < num),
    // negative on hard error (POSIX: -1+errno; Windows: <0 + WSAGetLastError).
    // Partial send MUST re-arm writable → later on_drain (one-shot; cleared before callback).
    pub fn send(&mut self, payloads: &[*const u8], lengths: &[usize], addresses: &[*const c_void]) -> i32;

    pub fn user(&mut self) -> *mut c_void;
    pub fn bound_port(&mut self) -> i32;                      // host order, cached
    pub fn bound_ip(&mut self, buf: *mut u8, len: &mut i32);  // *len=0 if too small/error
    pub fn remote_ip(&mut self, buf: *mut u8, len: &mut i32);
    pub fn close(&mut self);            // sync: poll stop, fd close, closed=1, push closed list, THEN on_close
    pub fn connect(&mut self, host: *const c_char, port: u32) -> i32;   // 0 ok; -1+errno; or EAI code
    pub fn disconnect(&mut self) -> i32;                                // connect(AF_UNSPEC)
    pub fn set_broadcast(&mut self, bool) -> i32;
    pub fn set_unicast_ttl(&mut self, i32) -> i32;
    pub fn set_multicast_ttl(&mut self, i32) -> i32;
    pub fn set_multicast_loopback(&mut self, bool) -> i32;
    pub fn set_multicast_interface(&mut self, &sockaddr_storage) -> i32;
    pub fn set_membership(&mut self, addr: &sockaddr_storage, iface: Option<&sockaddr_storage>, drop: bool) -> i32;
    pub fn set_source_specific_membership(&mut self, src: &sockaddr_storage, group: &sockaddr_storage,
                                          iface: Option<&sockaddr_storage>, drop: bool) -> i32;
}

// Loaned to on_data only. Batch ≤ 8 (recv_buf 512KiB / 64KiB slots); per-packet peer
// sockaddr_storage, payload ptr+len, truncated flag. Windows batch = 1.
pub struct PacketBuffer;
impl PacketBuffer {
    pub fn get_peer(&mut self, i: i32) -> &mut sockaddr_storage;
    pub fn get_payload(&mut self, i: i32) -> &mut [u8];
    pub fn get_truncated(&mut self, i: i32) -> bool;
}
```

**Behavioral contracts that MUST hold** (consumers rely on each):
1. `close()` invokes `on_close` **synchronously** and re-entrantly from JS-initiated close, error-guard close, and deinit close (udp_socket.rs:1585, 542, 1716) — callbacks read the user pointer during it.
2. No callback of any kind after `on_close`; `us_udp_socket_t` memory (and thus `user()`) stays readable until the end-of-iteration closed-list sweep (`closed_udp_head` is read from Rust, InternalLoopData.rs:44).
3. `send` return-code convention: POSIX errno only when `rc == -1`; Windows failure is `rc < 0` + WSA error; `setsockopt` wrappers return raw rc (0 success). `errno_sys`/`get_us_error` (udp_socket.rs:48–69, 1829–1860) encode this exactly.
4. Recv dispatch loops batches until EAGAIN; the consumer breaks the per-packet loop when `closed` flips mid-batch — the rewrite must tolerate `close()` being called from inside `on_data`/`on_drain` (loop.c re-checks `u->closed` after every callback).
5. Linux ICMP errors → `on_recv_error` without closing; non-Linux error events → close. Drain is one-shot (WRITABLE cleared before `on_drain`), re-armable from within the callback.
6. Payload/peer pointers handed to `on_data` may live in a loop-shared buffer; validity ends when the callback returns.
7. `bound_port` must remain valid after `close()` begins? — No: consumers gate every getter on `closed`/`socket.is_some()` (udp_socket.rs:1633–1637 etc.), so post-close calls never happen; but `user()` **is** called during `on_close` itself (from_uws).
8. `connect` accepting a hostname (goes through getaddrinfo) and returning negative EAI codes distinct from -1/errno (udp_socket.rs:634–643).
9. Port 0 as "unspecified" sentinel for both bind and connect coercion paths.
10. Windows: `closed=false && socket=None` transient states exist (udp_socket.rs:758–761) — option setters must EBADF, not assert.

**node:dgram-specific dependencies:** only `Bun.udpSocket` (bind flags, data/error handlers), `socket.send(data[, port, ip]) -> bool`, `socket.close()`, `socket.unref()/ref()`, `socket.address`/`remoteAddress` getters, `setBroadcast/setTTL/setMulticastTTL/setMulticastLoopback/setMulticastInterface/addMembership/dropMembership/addSourceSpecificMembership/dropSourceSpecificMembership`, plus direct native `UDPSocket.jsConnect`/`jsDisconnect` (dgram.ts:398, 430). dgram does **not** use `sendMany`, `drain`, `reload`, or `binaryType`.
