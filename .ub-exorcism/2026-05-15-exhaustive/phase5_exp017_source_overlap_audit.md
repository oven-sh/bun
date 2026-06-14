# EXP-017 source-overlap audit: `Request::store_callback_seq_cst`

## Verdict

`NO_EVIDENCE` for current Bun source overlap as of `origin/main@4d443e5402`.

The primitive Miri model remains valid: `write_volatile` plus `fence(SeqCst)` is not an atomic write and races with a plain read if the two accesses overlap on different threads. The current source audit did not find a path where Bun mutates `Request.callback` while the IO thread can concurrently read that same field.

## Source facts

`IoRequestLoop::schedule` is the cross-thread publication point. It sets `request.scheduled = true` and then pushes the request to the lock-free queue (`src/io/lib.rs:811-824`). The queue uses Release/Acquire edges: `push_batch` publishes via Release stores to `front` / `next` (`src/threading/unbounded_queue.rs:259-265`), and `pop_batch` consumes with an Acquire swap/load (`src/threading/unbounded_queue.rs:331-357`).

The IO thread reads the callback only after popping from that queue and immediately clearing `scheduled`:

- Linux/epoll: `src/io/lib.rs:868-870`
- macOS/FreeBSD kqueue: `src/io/lib.rs:1018-1020`

There are three current write-side call sites:

- `WriteFile::wait_for_writable` (`src/runtime/webcore/blob/write_file.rs:261-267`)
- `ReadFile::wait_for_readable` (`src/runtime/webcore/blob/read_file.rs:465-472`)
- `FileCloser::do_close` (`src/runtime/webcore/Blob.rs:7075-7088`)

The first two write the callback from the work-pool owner immediately before scheduling the request, then return without doing further work on that request until IO readiness schedules another work-pool task. That is a non-overlapping "write before publication" shape.

The close path looked suspicious because it writes before checking `if !io_request.scheduled`. A source audit of all `do_close` call sites found it is only called from `on_finish` in `ReadFile` / `WriteFile`. Those `on_finish` calls happen after either ordinary work-pool completion or an IO readiness/error callback. In the readiness path, the IO thread has already popped the request and set `scheduled = false` before dispatching `on_ready`, which schedules the work-pool task. In the deferred-close path, `do_close` schedules a close request and returns; no second work-pool callback is scheduled until the IO thread processes that close request and `on_close_io_request` clears `close_after_io`.

`rg` cross-check:

- `ClosingState::Closing` is stored only in `FileCloser::do_close`.
- `do_close` for this trait is called only from `ReadFile::on_finish`, `WriteFile::on_finish`, and the Windows `ReadFileUV` path that does not use this POSIX `io_request` queue.
- `store_callback_seq_cst` is called only at the three sites listed above.

## Defensible conclusion

Do not count EXP-017 as production UB today. The registry should retain the primitive Miri witness as a regression guard, but the source-backed finding should be demoted from `OPEN` to `NO_EVIDENCE`.

The code still deserves hardening:

1. The comment in `Request::store_callback_seq_cst` overclaims. A volatile write plus fence is not an atomic publication primitive.
2. A plain field assignment before `IoRequestLoop::schedule` would be easier to reason about because the queue already provides Release/Acquire publication.
3. Add `debug_assert!(!io_request.scheduled)` before callback rewrites if the intended invariant is "callback changes only while unscheduled."
4. If future code needs to change callbacks after queue publication, then the callback slot must become a real atomic representation (`AtomicPtr` / `AtomicUsize` plus typed trampoline) or be protected by a state transition that excludes the IO-thread read.
