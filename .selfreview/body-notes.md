<details><summary>Notes</summary>

**Contract**

- No component retries `accept()` with no delay.
- A connection that `accept()` left queued stays in the backlog. The server accepts it 2 to 3 loop iterations after `accept()` works again (at most one 5 ms period).
- The change adds no output and no API: no warning, no `error` event.
- `bsd_accept_left_connection_queued` (`packages/bun-usockets/src/bsd.c`) decides by exclusion. Would-block does not back off. The errors that take the connection off the queue do not back off: `ECONNABORTED`, `EPROTO`, `EPERM`, `ENETDOWN`, `ENOPROTOOPT`, `EHOSTDOWN`, `ENONET`, `EHOSTUNREACH`, `EOPNOTSUPP`, `ENETUNREACH`. Every other error backs off, which includes `EMFILE`, `ENFILE`, `ENOBUFS` and `ENOMEM`.
- Only a failure of the first `accept()` of a readiness report backs off. A failure after one or more accepts in the same batch ends the batch as before. The next report then reaches the first `accept()`.
- A backed-off listener holds one sweep reference for the whole episode. The reference keeps `sweep_next_tick_ns` armed when the last socket unlinks. `accept_backoff_sweep_ns` keeps the sweep's own deadline, so the 4 s sweep still runs on time.
- If the registration of a backed-off listener fails (`us_poll_start_rc`), the listener stays backed off and the loop tries again 5 ms later.

**Tests**

- `serve-syscall-fault.test.ts`: `Bun.serve` with `EMFILE`, `ENFILE`, `ENOBUFS`, `ENOMEM` injected into `accept()`. A failed registration of the backed-off listener. `stop()` of a backed-off server. One test without the injector: a real descriptor limit under `ulimit -n 512` (Linux).
- `socket-syscall-fault.test.ts`: `Bun.listen` on TCP and on a unix socket, the same four errors.
- `net-syscall-fault.test.ts`: `net.Server` and `http.Server`, the same four errors. One test for the excluded errors: 20 injected `ECONNABORTED` or `EPROTO` failures take 20 to 21 loop iterations, where `EMFILE` takes 39.
- Each back-off test counts loop iterations per 10 ms timer with `getEventLoopStats().iteration`. It asserts that the count while `accept()` fails stays within 8 of the idle count, and that the queued client gets its answer after the failure clears. No test compares CPU time against wall time.
- The injector tests run only on ASAN builds. The `ulimit` test runs on every Linux lane. On the released build it measures about 1,500 to 2,100 iterations per timer against 1 idle.

**Measurements**

Linux x64, epoll. Debug + ASAN builds of this change and of the same base without it, unless a line says otherwise. The host was under heavy load, so wall-clock numbers have a wide spread.

- Instructions, read from objects compiled with the release flags, ThinLTO off. `us_internal_sweep_if_due`: 3 with the sweep off and 18 when armed and not due, equal to main. Its due path (once per 4 s) goes from 23 to 25. A successful accept has the same instruction sequence. A first `accept()` that fails takes 4 more instructions and one call to `bsd_would_block` (9 instructions). Each listen call has one more store. The link and unlink paths are not touched.
- Bytes: `.text` +605 (loop.o +521, bsd.o +69, context.o +15). rodata and data +0. 511 of the bytes are in three cold functions. `us_internal_loop_data_t` grows from 208 to 216 bytes. `us_loop_t` (12,528 bytes) and `us_listen_socket_t` (128 bytes) keep their size. A release link of both sides was not made.
- Descriptors: the descriptor count after start, `spawnSync`, 4 Workers, `fetch` and `Bun.serve` is equal on both builds. A Worker starts with 3 free descriptors and fails with 2 on both builds.
- Syscalls in 10 s at a real descriptor limit (`ulimit -n 256`, one queued client), counted with an `LD_PRELOAD` interposer. With the change: 1,584 failed `accept4`, 3,173 `epoll_ctl`, 3,189 loop iterations, 431 ms CPU. Base: 245,908 failed `accept4`, 5 `epoll_ctl`, 3,316 ms CPU. Released 1.4.3-canary.1 (367d939d9): 1,973,902 failed `accept4`, 4,461 ms CPU. A second run on a busier host: 392, 211,553 and 1,377,272 failed `accept4`.
- Loop iterations per 10 ms timer while `accept()` fails: 3.65 to 4.95 with the change, 101 or more on the base.
- Recovery after the failure clears, 20 episodes: 2 to 3 loop iterations with the change, 2 on the base. Wall time min / median / max: 2.9 / 10.3 / 330 ms against 2.8 / 9.7 / 325 ms.
- Sweep reference balance: loop iterations in an idle 12 s window at start, after 20 recoveries, after `stop()` of a backed-off server, and after a failed registration. With the change: 15, 13, 2, 2. Base: 17, 12, 2, 2. A leaked reference keeps a 1 Hz timer alive and adds 12 or more.
- Throughput at the limit: 64 clients, one request per connection, a handler that awaits 1 ms, 6 interleaved rounds, requests/s. 1 free descriptor: 37 to 107 (median 62) against 18 to 336 (median 172). 2 free: 51 to 270 (141) against 80 to 463 (271). 8 free: 155 to 545 (236) against 163 to 716 (257). 32 free: 93 to 478 (226) against 23 to 433 (270). No request failed on either build (90,007 in total).
- With a handler that answers synchronously, `accept()` does not fail at the limit on either build. `TCP_DEFER_ACCEPT` lets the loop serve and close each connection inside the accept batch: 0 failed `accept4` in 2,428 and 3,114 accepts with 2 free descriptors.
- The change adds no host function, no exported symbol and no generated binding.
- Not measured: run-time instruction counts (`valgrind` and `perf` are not installed), release-build sizes (`bloaty` is not installed and no release build of both sides exists), release-build throughput. `strace` is not installed, so the `LD_PRELOAD` counter replaced it.
- The measurements ran before the last rebase and before the libuv arm was dropped. The epoll code did not change after them. The tests ran again on the final commit.

**Not observed**

- macOS: no machine ran the kqueue arm. The PR makes no claim about a spin on macOS.
- Windows: not changed. The call is under `#ifndef LIBUS_USE_LIBUV`. An arm for libuv (park the listener, restore it from a one-shot timer) was written and dropped: no machine could run it, the spin was never observed on Windows, and #42819 deletes the libuv backend.

**Noted, not changed**

- At `EMFILE`, Node.js accepts and closes the queued connections (libuv `uv__emfile_trick`). Bun keeps them queued, before and after this PR. A change of that behaviour for `node:*` listeners needs a maintainer's decision.
- No listener-level channel reports an accept error to JS.
- The retry costs 3 syscalls per failed attempt (`accept4`, `EPOLL_CTL_DEL`, `EPOLL_CTL_ADD`).
- A retry on socket close, before the 5 ms pass, would recover the throughput at the limit. It would add a load and a branch to every socket close, so this PR does not do it.
- Not checked: a listener whose poll reports an error or a hang-up with no failed `accept()`.
- #42819 (Remove libuv on Windows) changes the accept call in `loop.c`. `accept_backoff_sweep_ns` has no `cfg` in `InternalLoopData.rs`, so the Rust mirror stays correct when that PR removes the Windows split. #39641 (descriptor exhaustion at loop creation) is not touched.

**History of this PR**

- First iteration: the listener paused until the 4 s sweep, so a server at its limit accepted once per 4 s.
- Second iteration (402e15cba2): a reserve descriptor per loop, an accept-and-close drain, a stderr warning and a 200 ms pause. The drain reset clients that bun serves today, the reserve cost one descriptor per loop, and `ENOBUFS` and `ENOMEM` still spun.
- This iteration removes all of that. It keeps the idea of both: the listener leaves the poll set, and a deadline folded into the poll timeout brings it back.

</details>
