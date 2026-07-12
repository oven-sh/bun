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

## ADDENDUM — shard P0b (owner-flagged perf item, runs with Phase D)
uWS/Dynamic ext must return to being CONTIGUOUS with the socket header (C
parity: us_socket_ext == fixed offset). Implement per-loop slab size classes:
group-vtable kinds allocate from a size-class slab whose slot = header + ext
bytes inline (class chosen by family-max ext size registered at listen/context
creation; ~5 distinct sizes per loop). Rust kinds keep the uniform slab +
inline 8-byte word. Delete alloc_ext_area/free_ext_area for sockets (listener
ListenerData box may stay). ext_ptr_raw for group-vtable kinds = header+1
projection. Generation/deferred-close semantics unchanged. Both reviewer
lenses mandatory (touches unsafe_core/slab.rs).

## ADDENDUM — shards P0c + P10 (owner directive: unify tagged-pointer polls)
P0c (core): first-class non-socket poll registrations in bun_usockets. New
`PollSource` enum: Fd{readable,writable} | cfg(darwin): Proc(pid),
Machport(port), Memorystatus. Registry = same slab/generation scheme as
sockets (poll kind byte distinguishes); dispatch via refcounted owner +
held guard (Protocol v2 trampoline); keep-alive integrated with
num_polls/active (no external field pokes). Backend trait grows the darwin
filter arms. DELETES from the public surface: ready_polls/current_ready_poll
back-channel, Bun__internal_dispatch_ready_poll extern, tagged-pointer udata
convention (incl. the kqueue ext[0] ad-hoc generation).
P10 (migration): src/io/posix_event_loop.rs re-implemented over P0c (FilePoll
becomes a thin typed wrapper or dissolves), src/io/windows_event_loop.rs
alignment (registration remains vestigial; keep uv-driven readiness),
EventLoopCtx consumers (process reaping, machport waker, pipes/stdin,
gc_controller if it registers polls), delete FilePoll deferred-free list +
after-event-loop free hook in favor of the core closed-drain. Acceptance:
grep proves no epoll_ctl/kevent outside bun_usockets backend/; both reviewer
lenses; subsystem tests incl. spawn (SIGCHLD/proc reaping) + macOS DNS paths
flagged for CI (cannot run on this box).

## ADDENDUM — P0b extension (owner-approved): chunk decommit reclamation
Chunks allocate via mmap reservation. When a chunk reaches 0 occupied slots,
decommit its pages (madvise MADV_DONTNEED / VirtualFree MEM_DECOMMIT, range
stays reserved) — stale handle validation reads then hit zero pages (gen 0,
never matches). ABA guard: per-chunk epoch in a loop-side table (NOT in
decommittable memory), bumped on decommit, packed into generation high bits
(slots + handles). Recommit lazily on next alloc from that chunk. Add unit
tests: RSS-visible decommit (touch-then-drain), stale-handle-after-decommit
safety, epoch ABA (handle from cycle N never validates in cycle N+1). Hysteresis:
keep the most-recently-emptied chunk committed (avoid thrash on connect/close
oscillation at a chunk boundary).

## ADDENDUM — shard P0d (owner directive, REVERSES api.md CHANGES item 2)
Per-socket TLS spill is rejected: it was justified by relocation-elimination,
but the slab already eliminated relocation, leaving an O(congested-sockets)
memory cost with no benefit. Revert tls/state.rs to the C architecture:
loop-shared ciphertext BIO buffers + ONE loop-shared spill slot per loop
(O(1) memory), preserving the ported batch thresholds. Rust-ify the two C
hazards: spill/fatal-reason OWNER is a generation-checked SocketRef (stale =
drop, never dangles); the save/restore re-entrancy protocol is an RAII scope
guard (nested TLS entry from JS re-entrancy restores on drop, enforced by
type). Verify against tls-semantics.md §re-entrancy rules; both reviewer
lenses; ws + upgradeTLS + server-SNI suites are the regression gate.

## P0b clarification (epoch lifetime + width)
The per-chunk epoch table is loop-owned and NEVER freed before loop teardown —
it is the deliberate irreducible residue of stale-handle safety (one word per
64-slot chunk; ~13KB at 100k-socket high-water). Chunk reuse (recommit) is
preferred over appending, so the table is bounded by peak chunk count.
Generation width: u64 in both slots and handles (SocketRef has free padding) —
epoch in high 32, slot counter in low 32 — so epoch wrap is unreachable
(~2^32 decommit cycles per chunk). Do NOT pack into u32.

## P0b REVISION (owner directive — SUPERSEDES the mmap/decommit design above)
Chunks are plain mimalloc allocations (bun_alloc default allocator), 256 slots
per chunk, mi_free'd when empty (hysteresis: keep the most-recently-emptied
chunk). NO mmap reserve / madvise / recommit machinery.
Validation root moves to the loop-owned CHUNK TABLE (never shrinks; the
irreducible residue, now peak/256 entries): handle = {ptr, chunk_idx: u32,
gen: u32}; validate = bounds-check chunk_idx -> entry {base, len, epoch};
dead if entry freed/epoch-mismatch or ptr outside [base, base+len); else
deref slot counter. NEVER deref the slot before the table check (freed chunk
memory is recycled — a raw deref could falsely validate). Epoch bumps on
chunk free; table slot reuse for new chunks keeps the table bounded by peak.
Kernel udata: unchanged discipline (poll_stop precedes slot free, per W2);
debug_assert layer may keep the old deref check on the dispatch path since
dispatch only sees live-registration pointers.
Tests: stale-handle-after-chunk-free safety (must not touch freed memory —
ASAN is the oracle), epoch ABA across chunk-slot reuse, hysteresis, 256-slot
boundary churn. Size classes (uWS inline ext) unchanged, applied per class.

## P0b FINAL (owner decision — supersedes BOTH prior P0b reclamation designs)
Reclamation = the MADV design, with the mimalloc revision's sizing kept:
- Chunks: mmap-reserved, 256 slots each. Empty chunk (hysteresis: keep the
  most-recently-emptied one committed) -> madvise(MADV_DONTNEED) (Linux/mac;
  MADV_DONTNEED specifically, NEVER MADV_FREE — zero-fill guarantee is load-
  bearing) / VirtualFree(MEM_DECOMMIT) on Windows. Address range stays
  reserved; stale-handle validation remains a single slot deref (zero page =>
  gen 0 => dead). NO chunk table on the validation path.
- Generations u64: chunk epoch (loop-side array, bumped per decommit) in high
  32, slot counter low 32. Epoch array = the residue (~8B per 256 peak
  sockets), lives until loop teardown.
- LOOP TEARDOWN MUST FULLY RELEASE: munmap / VirtualFree(MEM_RELEASE) every
  reservation + free the epoch array when the loop is destroyed (workers +
  HTTP thread churn must not accumulate reservations). Safe per the existing
  on_thread_exit ordering: validation only runs on the loop's thread and
  teardown is its final act after group drain.
- Tests: RSS drop after drain (touch/measure/decommit/measure), stale-handle
  read-after-decommit returns dead (and ASAN-clean), epoch ABA across
  recommit, hysteresis boundary churn, full-release-at-teardown (no
  reservation growth across N worker create/destroy cycles).
