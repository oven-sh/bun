### Problem
- `child.stdin.write(chunk, cb)` and `process.stdout.write(chunk, cb)` run callbacks out of write order: the repro in Notes prints `2,1,3`, Node `1,2,3`.
- Cause: `writeFast` calls `cb(null)` inside `write()` (`src/js/internal/fs/streams.ts:703`), ahead of writes the sink still holds.
- It also cuts `write("", () => process.exit(0))` to 65536 of 1048576 bytes. A `write(x, next)` loop throws `RangeError: Maximum call stack size exceeded`.

### Fix
- A write with a callback also sends a zero-length marker through `Writable`, which orders it with `end()`, `_final` and `destroy()`.
- A chunk that `Writable` holds goes out first. A failed write destroys the stream even without `autoDestroy`, and `process.stdout` recovers as in Node.
- Verified: `test/js/node/process/process-stdio-write-callback.test.ts` and two more. 56 of 103 tests fail on main.
- Self-reviewed: 14 concerns raised, 13 addressed. Open: Windows has not run yet.

### Background
- These streams are `fs.WriteStream`s whose own `write()` (`writeFast`) gives each chunk to a `FileSink`, which can hold it, and skips `Writable`.
- Considered: a second queue in `writeFast` (cheaper, `end(chunk)` and `destroy()` bypass it), and no `writeFast` (#33508: 22 to 24% on every write).

### Downsides
- Needs #42031 first. Main drops a tick queued in an `'unhandledRejection'` handler, so a handler that exits from a write callback exits 0.
- `write(chunk, cb)` costs one `Writable` write more: 796 ns against 198 ns with a new closure per write (Node: 1497 ns). No callback: no change.
- Callbacks run one tick later. `'drain'` fires once for writes held together.

<details><summary>Notes</summary>

#### Repro

Exit code 1 on main, 0 with this PR and on Node v26.3.0. There is no issue for this. The report came from differential fuzzing against Node.

```js
// child.stdin.write(chunk, callback): the callbacks must fire in the order of the writes.
import { spawn } from "node:child_process";
if (process.argv[2] === "kid") { process.stdin.resume(); process.stdin.on("end", () => process.exit(0)); }
else {
  const rest = [import.meta.filename, "kid"];
  const kid = spawn(process.execPath, process.versions.bun ? ["--no-install", ...rest] : rest, { stdio: ["pipe", "ignore", "inherit"] });
  const order = [];
  kid.stdin.write(Buffer.alloc((1 << 20) + 1), () => order.push(1));
  kid.stdin.write("", () => order.push(2));
  kid.stdin.write("x", () => order.push(3));
  kid.stdin.end(() => { console.log("callbacks fired in the order", order.join(",")); process.exit(order.join() === "1,2,3" ? 0 : 1); });
}
```

#### Behaviour (release builds of main 5866b5f13d and of this branch, Linux x64, Node v26.3.0)

| Probe | main | this PR | Node |
|---|---|---|---|
| The repro | `2,1,3` | `1,2,3` | `1,2,3` |
| `stdout.write(1 MiB); stdout.write("", () => process.exit(0))` into a pipe | 65536 of 1048576 bytes, exit 0 | 1048576 | 1048576 |
| `function next() { if (++n < 200000) process.stdout.write("x", next) }` | `RangeError: Maximum call stack size exceeded.` | completes | completes |
| `write("A", w1); moveCursor(0, 0, m0); write("B", w2); cursorTo(3, c); moveCursor(1, 0, m1)` | `w1,w2,c,m1,m0` | `w1,m0,w2,c,m1` | `w1,m0,w2,c,m1` |
| `write(w); nextTick(t1); write(w); nextTick(t2); write(x); write(w)` | `w,w,x,w,t1,t2` | `w,w,t1,t2,x,w` | `w,w,t1,t2,x,w` |
| A callback that throws, chunk taken at once | the throw leaves `write()` | `uncaughtException` | `uncaughtException` |
| A callback that throws, chunk held by the sink | `unhandledRejection` | `uncaughtException` | `uncaughtException` |
| The pipe breaks with `write(1 MiB, w0); write("", w1); write("b", w2)` pending | `w1` inside `write()`, `w0:EPIPE`, `w2:EPIPE`, `error` | `w0:EPIPE`, `w1:EPIPE`, `w2:EPIPE`, `error` | same as this PR |
| `write(1 MiB, cb); Writable.prototype.write.call(stdout, "B"); write("C")`: the bytes after the first chunk | `BC` | `BC` | `BC` |
| Two writes of 1 MiB in one turn: `'drain'` events | 2 | 1 | 1 |
| After a handled `EPIPE` on piped stdout: `errored`, and a later `write(chunk, cb)` | `EPIPE`, the callback runs inside `write()` | `null`, the callback runs | `null`, the callback runs |

#### How the marker works

- `writeFast` still calls `sink.write(chunk)` inside `write()`. When the sink returns a promise, the writes that it parks on that promise form a run.
- A write that has a callback then calls `Writable.prototype.write(marker, cb)` with a zero-length `Buffer`. `Writable` queues it like any chunk and calls `_write` for one marker at a time.
- `_write` completes a marker at once when its chunk joined no run. Otherwise it completes it when the run settles: with `null`, or with the error of the run. `'drain'` is emitted once per run, on a tick before the callbacks.
- So the callbacks come out of `Writable` in call order, `end()` waits for them, and `destroy()` and a failed write report through `Writable`'s own paths.

#### The contract table

- `process-stdio-write-callback-fixture.js` runs one row: a stream (`process.stdout`, `process.stderr`, `child.stdin`), the state of its pipe (room, full, breaks) and a sequence of calls. It runs unchanged under Node: `node process-stdio-write-callback-fixture.js stdout parked "write x3"`.
- All 96 rows, Node against this PR: 84 reports are identical. The other 12 are rows with `destroy()` or with a write made from the `'error'` listener. There the test checks only that each write callback runs once, in order, after the calls, because Node and Bun do not give those callbacks the same result.
- Main differs from Node in 67 of the 96 rows.
- A larger table from the review of this branch (141 rows: also `tty.WriteStream`, a Worker's `process.stdout`, `net.Socket`, `fs.createWriteStream`, `PassThrough`) has four clauses: no callback inside `write()`, write callbacks in write order, the `end()` callback and `'finish'` after them, each callback once. This PR: 0 rows fail. Main: 60.

#### Cost (release builds of main and of this branch, Linux x64)

| Per write | main | this PR |
|---|---|---|
| No callback, `"hello world\n"` to /dev/null, median of 10 interleaved rounds | 130.1 ns | 131.0 ns (spread 6 to 8%) |
| No callback: ticks, objects held, write syscalls | 0, 0.31, 1 | 0, 0.31, 1 |
| One shared callback, 200,000 writes in one turn | 190.9 ns | 427.3 ns |
| A new closure per write, 200,000 writes in one turn | 198.2 ns | 796.0 ns |
| Each callback makes the next write, 10,000 writes | 392.8 ns | 1584.5 ns |
| A new closure per write, 20,000 writes per round, best of 17 rounds | 130.3 ns | 224.0 ns |
| Ticks per 1000 writes: shared callback, new closures | 0, 0 (the callbacks ran inside `write()`) | 1, 1000 |
| Bytes held per write until it reports: new closure, chunk taken at once | 36 | 228 |
| Objects held per write while the sink holds it: no callback, shared callback | 5.02, 5.02 | 0.02, 1.02 |
| Heap after 200,000 writes in one turn: shared callback, new closures | 0.66 MiB, 0.66 MiB | 0.80 MiB, 35.91 MiB |

- Node v26.3.0 on the same three loops: 496 ns, 1497 ns, 1740 ns. Its heap after the burst with new closures: 58.52 MiB.
- The added cost is that of one write to a plain `Writable` whose `_write` completes at once: 166 ns with a shared callback, 477 ns with a new closure, 1290 ns in the loop where each callback makes the next write.
- Size: `internal/fs/streams.js` 17505 to 19493 bytes. Release binary text (`size`): 106,331,459 to 106,333,447 bytes, which is the same 1,988 bytes.
- Not measured: instructions per write. `perf`, `valgrind`, `strace` and `bloaty` are not installed here, and the container has no PMU.

#### Tests

- The three test files: 103 pass with this PR (debug build and release build). With main: 47 pass, 56 fail.
- Each clause of the new code was removed in turn, 16 changes. 13 make at least one test fail. The other three change nothing that a caller can see: clearing the run when it settles, the `markers === 0` condition, and the tick before a marker reports the error of a run that failed before `Writable` dispatched it.
- `test/js/node/{process,child_process,readline,stream}`, `tty.test.ts` and `test/regression/issue/25432.test.ts` (42 files, 852 tests, debug build): 14 fail. 10 of them fail with main's stream code in the same run. The other 4 are 5 s timeouts of tests that need 3 to 5 s in this container and that also time out on main.
- Vendored Node tests: 238 files (`child-process`, `stdio`, `stdout`, `stderr`, `stdin`, `tty`, `readline`, `console`, `fs-write-stream`, `process-exit`, `stream-writable`, `stream-pipeline`, `stream-finished`, unhandled rejections), release builds: 234 pass on main and with this PR, same exit code per file.
- Not run: macOS and Windows. The `process.stdout` and `process.stderr` rows use a FIFO and do not run on Windows. On Windows the sink of `process.stdout` writes synchronously, and one `uv_write` takes a whole chunk for `child.stdin`, so the tests that need a held write or a write that fails after it was accepted are skipped there.

#### What changes for callers

- A callback of `write()` runs one tick after the call. A throw from it is an `uncaughtException` in every case.
- `'drain'` fires once for all the writes that the sink held on one promise, on a tick. Main fires it once per held write.
- After a failed write, `process.stdout` and `process.stderr` on a pipe are destroyed and reset, as in Node: `errored` is `null` again and `'close'` is emitted. On main the stream stays errored. A `tty.WriteStream` that user code made is destroyed by a failed write.
- `cork()` now holds the callbacks until `uncork()`. The bytes still go out at once.
- User code that replaces `_write` on one of these streams now gets a zero-length chunk for each `write()` that has a callback. On main it gets no call at all. On Node it gets every chunk.

#### Needs #42031 first

- On main, work that an `'unhandledRejection'` handler queues never runs when nothing else keeps the process alive: `process.on("unhandledRejection", () => process.nextTick(() => process.exit(7)))` exits 0, Node exits 7.
- A stdio write callback runs inside `write()` on main, so `process.on("unhandledRejection", e => process.stderr.write(msg, () => process.exit(1)))` exits 1 today. With this PR alone it exits 0.
- #42031 runs that work. This branch merged with #42031 (no conflict): the handler case exits 1, and the tests here pass. This PR stays a draft until #42031 is in, and then adds the handler case to its tests.

#### Still as on main

- `write()` returns `true` for a chunk that the sink takes behind one that it holds. Node returns `false`.
- `writableLength` and `writableNeedDrain` stay 0 and `false`. The encoding argument is ignored (#33474).
- A small write to a pipe that is already broken reports success, because the sink buffers it (#41568).
- `write(data); process.exit()` with no callback truncates. #36419 and #41782 are other truncation reports. This PR does not change them.
- After `destroy()` the write that the sink holds reports what the sink says, which can be success. Node reports `ECANCELED`.
- When a write with no callback fails and a later write has one, `'error'` can come before that callback.
- `end(chunk)` and `Writable.prototype.write()` chunks complete inside the sink's promise reaction.
- `child.stdin` is constructed one tick after it is made. Until then its write callbacks wait, and a `destroy()` in that tick gives `ERR_STREAM_DESTROYED` to the callbacks of writes that the sink already took. #45195 makes the stream constructed from the start.

#### Other open PRs

- #37128 (console output goes behind what the stream has buffered) no longer touches `streams.ts` and keeps `writeFast`. No conflict with this branch.
- #45002 (`child.stdin`'s `_final` ends the pipe) conflicts in two type lines of `streams.ts` and in `child-process-stdio.test.js`. Merged by hand, one of its tests changes: "end(cb) after a write() that failed calls back without autoDestroy" expects `write callback, error, end callback`. With this PR the order is Node's: `write callback, end callback, error`. The PR that merges second updates that line.
- #44954 conflicts textually in `streams.ts`, where both add functions at one place. #45195 and #45318 conflict in test files only. #36316 makes `child.stdin` a `net.Socket`, which takes it off this path. #44980 and #42031 do not conflict.

</details>
