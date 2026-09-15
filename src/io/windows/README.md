# `bun_io::windows`

Pipes, the console and plain files on Windows, driven by the loop's completion
port (`packages/bun-usockets/src/eventing/iocp.c`, `bun_uws_sys::iocp`). The
module docs in `mod.rs` and `pipe.rs` describe the ownership rules.

## Synchronous pipe handles

A child process normally inherits its stdin/stdout/stderr as synchronous
(non-overlapped) pipe handles, because ordinary programs call
`ReadFile(h, .., NULL)` on them. A synchronous file object cannot do overlapped
I/O, cannot be associated with a completion port, and cannot be converted:

| attempt                                                                  | result                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `ReOpenFile(h, .., FILE_FLAG_OVERLAPPED)`                                | `ERROR_PIPE_BUSY`: a reopen is a new client connection                                         |
| `NtOpenFile` relative to the handle, empty name                          | `STATUS_PIPE_NOT_AVAILABLE`                                                                    |
| `CreateIoCompletionPort(h, port)`                                        | `ERROR_INVALID_PARAMETER`                                                                      |
| `NtSetInformationFile(FileModeInformation)` clearing the synchronous bit | `STATUS_INVALID_PARAMETER`                                                                     |
| `ReadFileEx`, or `ReadFile` with an `OVERLAPPED`                         | blocks the caller                                                                              |
| `WaitForSingleObject(h)`                                                 | always signalled; not a data-arrival signal                                                    |
| `FSCTL_PIPE_ASSIGN_EVENT`                                                | `STATUS_NOT_SUPPORTED` (removed from NPFS)                                                     |
| `SetNamedPipeHandleState(PIPE_NOWAIT)`                                   | the mode belongs to the pipe end, so every process sharing it sees it; no arrival notification |
| `KernelBase!NamedPipeEventSelect` (undocumented)                         | needs `PIPE_NOWAIT`; on Windows 10 also `FILE_WRITE_DATA`, which a read-only stdin lacks       |

So reads of a `Mode::Sync` pipe block on the pipe's own reader thread
(`pipe.rs`, `SyncReader`). It waits with a zero-byte read and then takes at most
what `PeekNamedPipe` reports, for three reasons: the wait consumes nothing, so
pausing leaves the data for whoever reads the handle next (a child that
inherits stdin); a zero-byte read can be cancelled without the peer's write
losing anything, where cancelling an N-byte read can; and a pending N-byte read
is charged against the writer's `WriteQuotaAvailable`, which has made
Cygwin/MSYS writers believe the pipe is full.

A request is answered in two steps: the thread reports that the pipe is
readable, and takes the bytes only when the loop asks again. Input therefore
leaves the pipe only after the loop thread has run with it waiting, as with a
readiness poll. While the loop is blocked (a synchronous spawn whose child
inherits the handle), it stays for the child. libuv does the same: its pool
thread only ever does the zero-byte read.

While the owner handles a chunk, the thread takes the next one only if it was
already in the pipe when that chunk was read, and skips the first step for it.
Reading the next chunk during the owner's callback is where the throughput of a
bulk stream comes from (waiting ahead without taking gains nothing). What
arrives later goes through both steps, so `pause()` from a `data` handler
leaves it for a child that inherits the handle, as on POSIX.

A chunk that was taken ahead and not yet asked for when the pipe is closed is
dropped with it.

## Follow-ups

### I/O rings for synchronous handles (Windows 11+)

Windows 11's I/O rings (`CreateIoRing`, `BuildIoRingReadFile`,
`BuildIoRingWriteFile`, `BuildIoRingCancelRequest`, `SubmitIoRing`,
`PopIoRingCompletion`, `SetIoRingCompletionEvent`; `ioringapi.h`, exported from
kernelbase.dll) do asynchronous I/O on a synchronous pipe handle as it is, with
no thread. Measured on build 26300, ring version 400, feature flags `0x2`:

- Submit returns in microseconds with the pipe empty; the read completes when
  the peer writes. `SubmitIoRing` does not block even while another thread is
  blocked in a plain `ReadFile` on the same handle, and a pending ring read does
  not block `PeekNamedPipe` from other threads.
- A zero-byte ring read completes on data arrival and consumes nothing, and
  leaves the writer's `WriteQuotaAvailable` alone (a pending 64 KiB ring read
  drops it to 0). It also completes on a zero-buffer pipe once a writer blocks.
- `BuildIoRingCancelRequest` and `CancelIoEx(h, NULL)` both complete the read
  with `ERROR_OPERATION_ABORTED`; nothing is consumed. A closed writer completes
  it with `ERROR_BROKEN_PIPE`.
- Writes work the same way: 64 KiB into a full 4 KiB pipe returns from submit at
  once and completes when the reader drains. Today a slow reader of a
  synchronous stdout blocks a helper thread per write.
- `CloseIoRing` does not cancel in-flight operations, and neither does the exit
  of the submitting thread: cancel and drain before freeing buffers.
- Works inside an AppContainer.
- 1 GiB through a synchronous pipe into a completion-port loop, MiB/s, with
  0 / 20 / 100 µs of loop work per 64 KiB chunk: ring read 6700 / 2456 / 588;
  reader thread with one chunk of read-ahead 4342 / 2591 / 605; a pool work
  item per chunk 2730 / 1579 / 494; libuv-style inline peek+read 4984 / 2310 / 581.

What stands in the way of relying on it:

- Reads need Windows 11 21H2 (build 22000); writes need ring version 300
  (22H2, build 22621). No Windows 10 and no Server 2022 has it, so the reader
  thread stays as the fallback.
- The exports are absent on older systems: resolve them with `GetProcAddress`
  from kernelbase. A static import breaks process start there.
- Microsoft documents nothing about which handle kinds ring operations accept.
  The only hint is "similar to calling ReadFileEx" (which does require an
  overlapped handle). It works; it is not promised; nobody is publicly known to
  use rings for stdio. Any failure has to fall back silently.
- The only completion signal is the event from `SetIoRingCompletionEvent`, which
  fires on the completion queue's empty-to-non-empty transition: wait on it with
  a wait completion packet on the loop's port, re-arm before popping, and pop
  until `S_FALSE`. Ring versions before 2 can miss the signal.
