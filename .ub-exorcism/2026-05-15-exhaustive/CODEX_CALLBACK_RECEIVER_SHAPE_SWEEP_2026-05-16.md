# Codex Callback-Receiver Shape Sweep — 2026-05-16

## Why This Sweep Exists

After EXP-099..104 and EXP-106, the highest-yield remaining UB pattern is not
"every `black_box(ptr::from_mut(self))` is bad." That would be too broad.

The precise bad shape is:

1. a callback-running entry point starts with a protected `&mut self` receiver;
2. the method launders that receiver through `black_box(ptr::from_mut(self))`;
3. it calls JS / SSLWrapper / uSockets / parent-vtable code that can synchronously
   re-enter the same object through a VM/raw-owner/intrusive-parent path; and
4. the re-entry creates a fresh mutable access to the same allocation while the
   original receiver tag is still protected.

`black_box` is useful against LLVM stale-field caching. It does not end the
Rust receiver's Stacked-Borrows / Tree-Borrows protector.

## Sweep Command

```sh
rg -n 'black_box\(.*from_mut\(self\)|let this: \*mut Self = .*from_mut\(self\)' src -g '*.rs'
```

## Existing Owners

| Source area | Registry owner | Verdict |
|-------------|----------------|---------|
| `src/jsc/ipc.rs:150` | EXP-099 | confirmed singleton `flush(&mut self)` / JS callback re-entry |
| `src/runtime/socket/UpgradedDuplex.rs` + `src/uws/lib.rs` | EXP-100 | confirmed SSLWrapper callback receiver re-entry |
| `src/http/ProxyTunnel.rs` stale wrappers | EXP-101/102/103 | confirmed leftover receiver wrappers around otherwise-good raw-owner callbacks |
| `src/runtime/socket/WindowsNamedPipe.rs:1176,1216` and generated callback shape | EXP-104 | confirmed `WRAPPER_BUSY` prevents UAF but not receiver-protector aliasing |
| `src/io/PipeWriter.rs:435,1584,2119` | EXP-106 | confirmed parent callback re-enters the same intrusive writer |

## Newly Promoted

### EXP-107 — `RareData::close_all_watchers_for_isolation`

`src/jsc/rare_data.rs:864-891` is source-explicit: watcher close callbacks
re-enter JS and can push back into the same `fs_watchers_for_isolation` /
`stat_watchers_for_isolation` vectors. The method still takes `&mut self`.

The Tree-Borrows model in `experiments/EXP-107` mirrors the loop:

- bad path: `close_all_watchers_for_isolation_bad(&mut self)` pops, calls a
  re-entrant push callback, then loops;
- good path: the same loop starts from a raw owner pointer.

Evidence:

- `phase5_experiment_results/EXP-107-bad.log` rejects the callback's fresh
  `&mut RareData`;
- `phase5_experiment_results/EXP-107-good.log` passes.

### EXP-108 — `EventLoop::{run_callback, run_callback_with_result}`

`src/jsc/event_loop.rs:455-507` is also source-explicit: JS callbacks can
re-enter through `vm.event_loop()` and run nested `enter()/exit()` pairs or
`drain_microtasks`. Host exports call these methods through
`global.bun_vm().event_loop_mut().run_callback(...)`, so the outer callback
runner has a protected `&mut EventLoop` receiver.

The Tree-Borrows model in `experiments/EXP-108` mirrors:

- bad path: `run_callback_bad(&mut self, callback, owner)` enters, calls a
  nested callback that mutably accesses the same loop via the owner pointer,
  then exits;
- good path: the same logic starts from a raw owner pointer.

Evidence:

- `phase5_experiment_results/EXP-108-bad.log` rejects the nested fresh
  `&mut EventLoop`;
- `phase5_experiment_results/EXP-108-good.log` passes.

This is distinct from EXP-073 (`CopyFileWindows` storing `&EventLoop`) and
EXP-084 (`VirtualMachine: Send + Sync` + unchecked TLS). EXP-108 is the
single-threaded callback-receiver defect in the event-loop runner itself.

### EXP-110 — `h2_frame_parser::Stream::queue_frame`

Follow-up after the initial sweep promoted this former suspect. The source
comment at `src/runtime/api/bun/h2_frame_parser.rs:1859-1867` explicitly says
`dispatch_write_callback()` can re-enter h2 host functions, look up the same
`Stream` through `client.streams`, and reach `queue_frame()` with a fresh
`&mut Stream` while the original receiver is still live.

The Tree-Borrows model in `experiments/EXP-110` mirrors:

- bad path: `queue_frame_bad(&mut self, client)` writes the frame queue, calls
  a JS-like write callback, then mutates the queue again;
- re-entry: the callback gets the same stream through the client raw owner and
  mutates it;
- good path: the same logic starts from a raw-owner queue-frame helper.

Evidence:

- `phase5_experiment_results/EXP-110-bad.log` rejects the callback's fresh
  `&mut Stream`;
- `phase5_experiment_results/EXP-110-good.log` passes.

## Reviewed But Not Promoted In This Sweep

| Source | Triage | Reason |
|--------|--------|--------|
| `src/io/PipeReader.rs:1286` | same-family suspect / remediation queue | The R-2 comment names parent re-entry, but the existing `BufferedReaderParent` macro uses several parent modes. Needs a source-faithful parent exemplar before counting separately; likely pairs with the EXP-106 `PipeWriter` remediation PR. |
| `src/runtime/webcore/s3/multipart.rs:605` | same-family suspect / remediation queue | `fail(&mut self)` calls a JS callback and then may rollback/deref. The state is set to `Finished` before callback, which may prevent the dangerous re-entrant mutation class. Needs a focused model before promotion. |
| `src/runtime/webcore/streams.rs:2012` | same-family suspect / remediation queue | `JSPromise::resolve` can re-enter JS, but a direct same-object mutation path must be shown. Keep under HTTPServerWritable sink review for now. |
| `src/runtime/api/bun/h2_frame_parser.rs:1868` | promoted to EXP-110 | Follow-up Tree-Borrows model now covers the source-commented `dispatch_write_callback` → `client.streams` → same `Stream` re-entry path. |
| `src/jsc/VirtualMachine.rs:3520` | existing-family hardening | `wait_for(&mut self)` drives the event loop; related to EXP-057/084 and EXP-108, but not separately modeled here. |
| `src/runtime/cli/test/parallel/Channel.rs:363` | no promotion | raw pointer capture has no `black_box` and no callback-running same-object proof from this sweep. |

## Remediation Pattern

The preferred repair is the same as EXP-012 / EXP-101-good / EXP-106-good:

1. keep true owner/lifetime guards where needed (`ref_guard`, intrusive ref,
   `ThisPtr`, etc.);
2. change callback-running entry points from `&mut self` receivers to raw-owner
   entry points (`*mut Self` / `NonNull<Self>`);
3. create only statement-scoped `&mut` borrows in spans that do not call JS /
   parent callbacks / SSLWrapper / uSockets;
4. keep `black_box` only where it remains useful for optimizer stale-load
   prevention, but do not treat it as a soundness proof.

## Public-Wording Guardrail

Do not write "all `black_box(ptr::from_mut(self))` sites are UB." The accurate
claim is narrower:

> Callback-running `&mut self` methods are UB when they can synchronously
> re-enter the same allocation through a VM/raw-owner/intrusive-parent path;
> `black_box` prevents stale LLVM caching but does not remove the Rust receiver
> protector.
