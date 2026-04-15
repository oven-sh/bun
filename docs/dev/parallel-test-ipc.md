# `bun test --parallel` coordinator/worker protocol

## Process model

```
coordinator (bun test --parallel=N)
  ├── worker 0  (bun test --test-worker)   ← Bun.spawn with ipc, serialization: "advanced"
  ├── worker 1
  ├── ...
  └── worker N-1
```

- Coordinator does file discovery (existing `Scanner`), holds the file queue, owns the reporter.
- Workers are `bun test` invoked with internal flag `--test-worker`. They skip discovery, skip reporter setup, and enter a receive-loop on `process.on('message')`.
- IPC via `Bun.spawn({ ipc, serialization: "advanced" })` → workers get `NODE_CHANNEL_FD` automatically (VirtualMachine.zig:487).

## Messages

Coordinator → worker:
```ts
{ kind: "run", file: string, idx: number }     // run this test file
{ kind: "shutdown" }                            // exit cleanly
```

Worker → coordinator:
```ts
{ kind: "ready" }                               // sent once on startup
{ kind: "file_start", idx: number, file: string }
{ kind: "test_done", idx: number, name: string, status: "pass"|"fail"|"skip"|"todo",
  duration_ms: number, error?: string }
{ kind: "file_done", idx: number, file: string,
  pass: number, fail: number, skip: number, todo: number, expectations: number,
  duration_ms: number }
{ kind: "stdout", idx: number, data: string }   // captured test output
{ kind: "recycle", reason: "rss"|"count" }      // worker is about to exit voluntarily
```

`idx` is the coordinator-assigned file index so out-of-order completions can be matched.

## Coordinator loop

1. Discover files → `queue: []string`
2. Spawn N workers
3. On worker `ready` or `file_done`: dequeue next file, send `run`
4. On `test_done` / `file_done`: feed into existing `CommandLineReporter` (need a "replay" entry point that takes the serialized event instead of being called inline by `Execution.zig`)
5. On worker exit (crash or `recycle`): if it had an in-flight file, re-queue it with `retry++`; spawn replacement worker
6. When queue empty and all in-flight done: send `shutdown` to all, print summary

## Worker loop

1. Detect `--test-worker` in `TestCommand.exec`, branch to `runAsWorker()`
2. Init VM with `--isolate` semantics enabled
3. `process.send({kind:"ready"})`
4. On `{kind:"run"}`: run file via existing `run(file)` path but with reporter replaced by an IPC-emitting reporter; after file, `swapGlobalForTestIsolation()`; check RSS/count → maybe `recycle`
5. On `{kind:"shutdown"}`: exit 0

## Reporter integration

`CommandLineReporter.handleTestCompleted` (test_command.zig:870) is the per-test sink. Add an alternate sink `IPCReporter` that serializes the same arguments and `process.send`s them. Coordinator side: a `replayTestCompleted(event)` that calls the same print path `handleTestCompleted` would.

## Recycling

- `--isolate-recycle-after=M` (default 50): worker exits after M files
- `--isolate-recycle-rss=BYTES` (default 1.5 GiB): worker checks `process.memoryUsage().rss` after each file
- On recycle, coordinator spawns replacement; bytecode cache on disk means warm-up is cheap

## Failure modes

- Worker crash mid-file: coordinator detects via subprocess exit; re-queue file with retry count; after 2 retries, mark file as crashed in summary
- Worker hang: per-file timeout already exists in `run()`; worker self-kills on timeout, coordinator sees exit
