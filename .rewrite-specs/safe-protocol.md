# Phase D — safe consumer interface (Protocol v2)

Goal (owner directive): consumers (HTTP client, Valkey, Postgres, MySQL, WS client, IPC, UDP,
Bun.listen/connect) contain NO unsafe for socket interaction. The socket interface is safe and
handles re-entrancy itself.

## Why consumer unsafe exists today (and what kills each class)

| Consumer unsafe pattern | Replaced by |
|---|---|
| ext = raw `*mut Owner`; callbacks deref via ThisPtr/container_of | Typed owner storage: kind registry stores `Owner: RefCounted`; trampoline recovers it type-safely (the single checked downcast already lives in unsafe_core) |
| ref_()/deref bracketing, DerefOnDrop, scopeguards around every callback (owner may be freed mid-call by re-entrant JS) | Core-held dispatch guard: the trampoline takes a strong ref on the owner BEFORE invoking the handler and drops it after — an owner can drop to zero refs mid-callback and stays alive until dispatch returns. Consumers delete every ref bracket |
| `&mut self` aliasing hazards / black_box launders / R-2 comments | Handlers receive `&Owner` (shared), never `&mut`. Owners are already interior-mutable (Cell/JsCell) from the R-2 migrations — this formalizes it in the trait |
| ext-null-before-close to suppress dispatch (cancel paths) | `Handle::detach_owner()` safe method: clears owner atomically w.r.t. dispatch; subsequent events no-op (core guarantee, replaces hand-nulling raw ext) |
| ext repoint before start_tls_handshake (adopt) | `adopt_tls(.., new_owner: Rc<O2>)` takes the new owner as an argument; core swaps owner and kind atomically — no window where dispatch sees a stale owner |
| stale-socket UAF checks / is_closed-and-pray | already solved: generation-checked handles (stale = Detached no-op) |
| deinit provenance dances (heap::take vs &mut protector) | owners become ordinary refcounted objects (bun_ptr) whose LAST release happens outside dispatch by core guarantee; the drop-in-callback footgun is structurally gone |

## API (additive; v1 raw Handler stays for uWS/Dynamic kinds until their turn)

```rust
pub trait Protocol: Sized + 'static {
    type Owner: bun_ptr::RefCounted;           // interior-mutable; !Send (loop-local)
    const KIND: SocketKind;                     // or a family pair for SSL variants
    fn on_open(o: &Self::Owner, s: Socket, is_client: bool, ip: &[u8]) {}
    fn on_data(o: &Self::Owner, s: Socket, data: &mut [u8]) {}
    fn on_writable(o: &Self::Owner, s: Socket) {}
    fn on_close(o: &Self::Owner, s: Socket, code: CloseCode2, errno: i32) {}
    fn on_end(o: &Self::Owner, s: Socket) {}
    fn on_timeout(o: &Self::Owner, s: Socket) {}
    fn on_long_timeout(o: &Self::Owner, s: Socket) {}
    fn on_connect_error(o: &Self::Owner, err: ConnectFailure) {}   // covers connecting too
    fn on_handshake(o: &Self::Owner, s: Socket, ok: bool, err: VerifyError) {}
    fn on_fd(o: &Self::Owner, s: Socket, fd: OwnedFd) {}
}
```

- `Socket` = the existing generation-checked Copy handle (safe methods only).
- Registration: `register::<P>()` monomorphizes into the existing static kind table; the
  trampoline (unsafe_core, written ONCE) does: validate generation -> load owner ref ->
  take dispatch guard (owner.ref_()) -> call safe handler -> drop guard (may run owner Drop
  AFTER handler returns; if handler closed the socket, core's deferred-close already ran).
- Owner attach: `connect(.., owner: OwnerRef<P::Owner>)`, `from_fd(.., owner)`, `adopt(..,
  owner)`, `Listener::on_create` returns the new owner. `OwnerRef` = safe strong ref
  (bun_ptr::IntrusiveRc or Rc — per-consumer, both satisfy RefCounted).
- Terminal contract: after on_close/on_connect_error returns, core drops ITS owner ref (the
  one the ext held). Exactly-once, on every terminal path (incl. C1 SEMI_SOCKET manual paths —
  core now releases the ext ref on silent close too, so consumers DELETE their compensation
  ref bookkeeping; behavior of "no callback fires" is unchanged, only the ref release is
  now core-owned. This is a deliberate, documented improvement over C parity — flag every
  consumer site whose compensation code dies).
- Re-entrancy: handlers may synchronously call any safe Socket method incl. close/adopt/
  connect. Core rules already guarantee ext-not-touched-after-terminal + deferred free.
- Cross-thread: unchanged (wakeup + queues); handles are Copy+Send-checked? NO — Socket is
  !Send by default; HTTP thread keeps its id->AnySocket map loop-locally (already the case).

## Migration shards (workflow #2, same write/2-review/apply shape)

| id | scope |
|----|-------|
| P0 | core: Protocol v2 trait + trampoline + owner storage + detach_owner + adopt owner-swap; keep v1 for Dynamic/UwsHttp*/UwsWs* kinds |
| P1 | Valkey (smallest, template for the pattern): delete deref_guard/ThisPtr/manual SEMI_SOCKET ref compensation |
| P2 | Postgres | P3 | MySQL | P4 | WS client (upgrade+framed+tunnel edges) |
| P5 | HTTP client: HTTPContext tagged-ext union becomes a safe enum Owner; pool slots hold OwnerRef; abort-tracker stays (already safe via generations). NOTE: AsyncHTTP bitwise-clone unsafe is NOT socket-interface unsafe — out of scope here, flagged separately |
| P6 | Bun.listen/connect (socket_body.rs, Listener.rs, uws_handlers.rs shrink/delete) — biggest |
| P7 | IPC + Channel | P8 | UDP owner path | P9 | sweep: grep remaining socket-related unsafe in consumers, list irreducibles with reasons |

Acceptance per shard: zero `unsafe` tokens related to socket lifecycle in the consumer
(JSC/FFI unsafe unrelated to sockets may remain but must be listed); all subsystem tests
green; the deleted-discipline list (ref guards, ThisPtr uses, ext pokes) named in the report.
