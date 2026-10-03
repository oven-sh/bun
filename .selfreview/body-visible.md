### Problem
- When `accept()` fails and leaves the connection queued (for example `EMFILE`), the event loop spins. Released 1.4.3 makes 137,000 to 197,000 failed `accept4` calls per second.
- The cause is the empty failure arm in `us_internal_dispatch_ready_poll` (`packages/bun-usockets/src/loop.c`), marked `/* Todo: start timer here */`.

### Fix
- On epoll and kqueue, `us_internal_accept_back_off` takes the listener out of the poll set. The loop registers it again 5 ms later. The connection stays in the backlog.
- The retry reuses `sweep_next_tick_ns`, the deadline that the loop already turns into its poll timeout.
- Correct because nothing retries `accept()` with no delay. The tick and a successful accept keep their instruction counts.
- Verified: new tests in `test/js/bun/http/serve-syscall-fault.test.ts`, `test/js/bun/net/socket-syscall-fault.test.ts` and `test/js/node/net/net-syscall-fault.test.ts` fail without the change. SELF_REVIEW_LINE

### Background
- A level-triggered poll reports a listener readable for as long as a connection is queued.
- The sweep deadline normally fires every 4 s to expire idle sockets.
- Designs weighed: a reserve descriptor that accepts and closes queued connections resets clients that bun serves today. A pause until the 4 s sweep starves a busy server.

### Downsides
- A server at its descriptor limit pauses 5 ms after each failed `accept()`. Debug builds, 64 clients, median requests/s of 6 rounds: 62 against 172 with 1 free descriptor, 236 against 257 with 8.
- While the failure lasts, the loop makes 158 failed `accept4` and 317 `epoll_ctl` calls per second.
- Windows is not changed: the libuv backend keeps the old behaviour. POSIX builds grow by 605 bytes of code.
