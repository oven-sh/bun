# EXP-046 Send-bound compile experiment

Run: `2026-05-16`  
Source: `origin/main@4d443e5402` on branch `claude/ub-exorcist-audit`  
Raw log: `phase5_experiment_results/EXP-046-send-bound-check.log`

## Question

Does EXP-046 remain a vague generic concern, or do Bun's real
`WorkTaskContext` / `ConcurrentPromiseTaskContext` impls rely on the unsafe
wrapper-level `Send` impl to move non-`Send` contexts across the work-pool
boundary?

## Experiment

Temporarily change the two safe context traits from:

```rust
pub trait WorkTaskContext: Sized { ... }
pub trait ConcurrentPromiseTaskContext: Sized { ... }
```

to:

```rust
pub trait WorkTaskContext: Sized + Send { ... }
pub trait ConcurrentPromiseTaskContext: Sized + Send { ... }
```

Then run:

```bash
cargo check -p bun_runtime 2>&1 | tee phase5_experiment_results/EXP-046-send-bound-check.log
```

The source change was reverted immediately after the check; no Bun source diff
is intended from this experiment.

## Result

The check fails on **all seven** real in-tree context impls with **57** `E0277`
non-`Send` / non-`Sync` errors:

| Impl site | Wrapper | Representative failing fields |
| --- | --- | --- |
| `src/runtime/webcore/blob/copy_file.rs:88` | `ConcurrentPromiseTask<CopyFile<'_>>` | `&JSGlobalObject` (`UnsafeCell<[u8; 0]>` / `*mut u8` !Sync), `PathOrFileDescriptor` raw string pointers, `JSValue` marker |
| `src/runtime/image/Image.rs:1382` | `ConcurrentPromiseTask<PipelineTask<'_>>` | `*const Image`, `&JSGlobalObject`, `*const ZStr`, `JSPromiseStrong`/`Strong`, `JSValue`, `Encoded` raw buffer |
| `src/runtime/api/JSTranspiler.rs:704` | `ConcurrentPromiseTask<TransformTask<'_>>` | `NonNull<JSTranspiler>`, `&JSGlobalObject`, `*mut Log`, `*mut FileSystem`, resolver/plugin raw pointers, `BunInstall` / `AutoInstaller` raw handles |
| `src/runtime/api/glob.rs:238` | `ConcurrentPromiseTask<WalkTask<'_>>` | `&JSGlobalObject`, `AtomicUsize` backref/raw pointer plumbing |
| `src/runtime/webcore/blob/write_file.rs:35` | `WorkTask<WriteFile>` | completion `*mut c_void`, `*mut WorkTask<WriteFile>` backref |
| `src/runtime/webcore/blob/read_file.rs:156` | `WorkTask<ReadFile>` | completion `*mut c_void`, `*mut WorkTask<ReadFile>`, path/string raw pointers, `JSValue` marker |
| `src/runtime/dns_jsc/dns.rs:1409` | `WorkTask<GetAddrInfoRequest>` | `*mut DNSLookup`, `*mut Resolver`, `NonNull<FilePoll>`, `BackRef<JSGlobalObject>`, `JSPromiseStrong` |

This is not a cosmetic bound. Current source compiles only because the wrapper
types assert:

```rust
unsafe impl<C: WorkTaskContext> Send for WorkTask<C> {}
unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}
```

without requiring the context traits themselves to be `Send`.

## Classification

Promote EXP-046 from `NEEDS_REFINEMENT` to:

```text
CONFIRMED_UB (unsafe-contract defect / generic safe-API boundary)
```

Defensible wording:

- The generic Miri witness remains the runtime proof that an owned task wrapper
  with an unconstrained `C` can launder `!Send` state into a worker thread.
- The new compile experiment proves Bun's real task contexts are in that
  non-`Send` set today.
- Per-context production exploitability is still separate. Some worker `run()`
  bodies deliberately avoid JS-thread-affine fields and only use copied/raw
  worker-safe state. Do **not** claim every context has an observed crash.
- The abstraction boundary is still unsound: the safe traits do not encode the
  thread-transfer contract, while the wrappers publish `Send`.

## Remediation implication

Do not blindly add `+ Send` and stop. The compile failure is valuable because it
shows the exact wrapper types that need either:

1. a real `Send`/worker-safe context split, or
2. an explicit unsafe marker trait such as `unsafe trait WorkPoolContext: Send`
   with per-context SAFETY comments explaining which fields are inert on the
   worker thread and which are only touched back on the JS thread.

`ConcurrentPromiseTask<C>` is the highest-priority half because it owns
`Box<C>`. `WorkTask<C>` stores `*mut C` and needs per-context lifetime/drop
review, but its safe trait still needs to stop implying that any `C` is valid.
