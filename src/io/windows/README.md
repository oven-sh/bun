# Windows I/O (`bun_io::windows`)

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
(`pipe.rs`, `SyncReader`). Like every mode, it waits with a zero-byte read and
then takes at most what `PeekNamedPipe` reports: the wait consumes nothing, so
pausing leaves the data for whoever reads the handle next (a child that
inherits stdin); a zero-byte read can be cancelled without the peer's write
losing anything, where cancelling an N-byte read can; a pending N-byte read
is charged against the writer's `WriteQuotaAvailable`, which has made
Cygwin/MSYS writers believe the pipe is full; and the first write to arrive
completes a pending N-byte read alone, however much is written behind it.

The doc comment of `SyncReader` describes how the loop and that thread take
turns. Input leaves the pipe only after the loop thread has run with it
waiting, as with a readiness poll: while the loop is blocked (a synchronous
spawn whose child inherits the handle), it stays for the child. libuv does the
same: its pool thread only ever does the zero-byte read. And the loop thread
waits while the bytes are taken and hands them over at once, so nothing of the
owner's runs with bytes out of the pipe that it has not been given: it can stop
reading from anywhere and lose nothing for a child. The wait is short. A reader
thread that is queued behind another process's read answers later, with a
packet, which is what keeps the loop from blocking where libuv's does.

### Finding out whether a handle is synchronous

Whoever made a pipe says what it is (`PipeOrigin`). For somebody else's handle
the kernel has to be asked, and every way of asking takes the lock of a
synchronous file object, which is held for as long as any thread of any process
has I/O in flight on it (a parked read of an inherited stdin, a writer blocked
on a full stdout). With another thread parked in `ReadFile(h, _, 0)`:

| call on a duplicate of the handle                                        | result                              |
| ------------------------------------------------------------------------ | ----------------------------------- |
| `NtQueryInformationFile(FileModeInformation)`                            | blocks                              |
| `SetNamedPipeHandleState`, `GetNamedPipeHandleState`, `GetNamedPipeInfo` | block                               |
| `PeekNamedPipe`                                                          | blocks                              |
| `CreateIoCompletionPort(h, port)`                                        | blocks, then refuses as above       |
| `GetFileType`, `NtQueryInformationFile(FileAccessInformation)`           | return at once                      |
| `NtQueryObject`, `DuplicateHandle`, `CompareObjectHandles`               | return at once                      |
| `CancelSynchronousIo` on a thread that is waiting for that lock          | `ERROR_NOT_FOUND`, the thread stays |

None of the calls that do not block tells the two kinds apart, and an
overlapped file object has no such lock. So a handle of unknown kind
(`Mode::Unknown`) is classified by the helper thread that does its first read or
write, before that thread's first I/O (`classify`), for as long as that takes.
The three standard handles are remembered once classified. The loop thread asks
only where it costs nothing more: when it is about to block on the same lock
anyway (a synchronous write: `process.stdout`, `Bun.write(fd)`), and of an end
nobody else does I/O on (`PipeOrigin::InheritedUnshared`, the IPC channel),
whose lock is free: it tries `CreateIoCompletionPort`, and success says
overlapped.

### What the reader thread costs

1 GiB through a synchronous pipe into a completion-port loop, MiB/s, with
0 / 20 / 100 µs of loop work per 64 KiB chunk and a writer that keeps the pipe
full:

| mechanism                                                                                   | MiB/s             | why not                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| I/O ring read                                                                               | 6700 / 2456 / 588 | see Follow-ups                                                                                   |
| libuv: zero-byte read on a pool thread, then peek + `ReadFile` on the loop thread           | 4984 / 2310 / 581 | the loop thread blocks in `ReadFile` when another reader of the pipe gets there first            |
| reader thread that takes the next chunk while the loop handles the current one              | 4342 / 2591 / 605 | that chunk is gone from the pipe if the owner pauses in its callback                             |
| reader thread that takes what is there as soon as it is asked, else waits and says readable | 3116 / 1600 / 515 | asked, the owner may still pause before the loop comes round: what was taken is gone for a child |
| a pool work item per chunk (wait, peek, read, post)                                         | 2730 / 1579 / 494 | same as the row above                                                                            |
| reader thread: wait, say readable, be asked, peek + read, post                              | 1891 / 1099 / 478 | two loop round trips per chunk, and the second has the window of the two rows above              |

With a writer slower than the reader (the pipe drains between chunks) every row
runs at the writer's speed.

That window is real. A process reads a bulk transfer, calls `pause()` from a
timer and starts a child that inherits stdin. Runs of 40 in which the child
missed a chunk: 4 to 7 for the last row, 40 for the row that takes as soon as it
is asked (29 with `setImmediate`), none for libuv.

In use (`SyncReader`): wait and say readable, as in the last row; then the loop
thread asks for the bytes and waits for them, hands them over, and asks again
for as long as there are any, up to `TAKES_PER_TICK` times. The hops are those
of the row that takes as soon as it is asked and the window is gone: none of 380
runs missed anything, 300 of them with several at once on one or two CPUs.

libuv's number comes from reading on, 64 KiB at a time, for as long as reads
come back full: one pair of thread hops for a burst, not for a chunk. The reader
thread gets the same from taking more at once: room is made for twice what the
pipe held the last time, up to the 256 KiB a POSIX reader takes
(`PIPE_READ_BUFFER_SIZE`), so a trickle keeps its 64 KiB buffers. `process.stdin`
of a child, 1 GiB, against libuv: 0.9 to 1.3 times its speed on 24 CPUs, 0.96 to
1.29 with the process tree held to 1, 2 or 4.

Spinning on the reader thread for about 30 µs before it parks hides the cost of
waking an idle core: +26 % with 24 idle CPUs, and -10 % to -50 % on 1, 2 or 4,
where it competes with the writer and the loop. Not done.

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
- Throughput: see the table under "What the reader thread costs".

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
