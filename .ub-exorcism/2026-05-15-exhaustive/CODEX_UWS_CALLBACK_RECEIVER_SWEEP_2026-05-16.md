# Codex `#[uws_callback]` Receiver Sweep — 2026-05-16

## Question

EXP-100..104 are all receiver-protector failures around callback-capable entry
points. That raises an obvious follow-up question: is `#[uws_callback]` itself
bad, or only a small subset of uses where the generated `&mut self` receiver is
held across synchronous callback re-entry?

## Macro Fact

`#[uws_callback]` is defined in `src/jsc_macros/lib.rs:824-848`. For `&mut self`
receivers it generates:

```rust
&mut *__ctx.cast::<Self>()
```

That is fine for simple one-shot calls. It becomes a Tree-Borrows problem when
the method then calls into a callback-capable subsystem that can synchronously
materialize another mutable reference into the same allocation.

## Inventory

Source query:

```sh
rg -n '^\s*#\[(bun_uws::)?uws_callback' src -g '*.rs'
```

Result: **38 real attributes** (documentation comments excluded).

| Area | Count | Verdict |
|------|------:|---------|
| `src/runtime/socket/UpgradedDuplex.rs` | 11 | EXP-100 owns the SSLWrapper-driving subset. Accessors / `raw_write` / timeout setter are not new findings. |
| `src/runtime/socket/WindowsNamedPipe.rs` | 13 | EXP-104 owns the representative SSLWrapper-driving subset. Accessors / `raw_write` / timeout setter are not new findings. |
| `src/runtime/webcore/Request.rs` | 6 | Not part of the SSLWrapper receiver family; `&self` callbacks use internal cells/request-context helpers. Keep under existing RequestContext lifetime/aliasing buckets, not a new EXP from this sweep. |
| `src/runtime/crypto/CryptoHasher.rs` | 3 | `&self` callbacks mutate hasher internals through the existing `with_mut` cells; no synchronous callback re-entry in this path. No new EXP. |
| `src/runtime/webcore/fetch/FetchTasklet.rs` | 2 | `abort_listener(&mut self)` and response finalizer are callback entries, but they do not drive SSLWrapper/uSockets re-entry. They stay in FetchTasklet lifecycle review, not this receiver family. |
| `src/runtime/timer/WTFTimer.rs` | 2 | `&self` query callbacks. EXP-026 covers the separate timer callback-running receiver issue, not these accessors. |
| `src/runtime/api/bun/subprocess.rs` | 1 | `handle_abort_signal(&self)` clears the abort signal and kills the process; no SSLWrapper/uSockets synchronous re-entry. No new EXP. |

## Positive Findings

The sweep is useful precisely because it prevents overgeneralization:

- The macro is **not** globally unsound.
- `&self` accessors and simple `&mut self` methods are not automatically UB.
- The confirmed bug class is narrower: a generated or internal whole-struct
  receiver remains protected while the method enters a subsystem that can
  synchronously invoke callbacks into the same allocation.

## Confirmed Owners

- **EXP-100**: `UpgradedDuplex` SSLWrapper-driving methods.
- **EXP-104**: `WindowsNamedPipe` representative SSLWrapper-driving methods.
- **EXP-026 / EXP-070 / F-21-2**: non-SSL callback-running receiver hardening
  vehicle, including `impl_streaming_writer_parent!(borrow = mut)`.

## No New EXP From This Sweep

I am intentionally not inflating the registry. The sweep found no additional
`#[uws_callback]` use outside the known SSLWrapper / callback-running receiver
clusters that deserves a separate confirmed-UB hypothesis today.

## Guardrail For Future Reviews

When a new `#[uws_callback]` method is added, ask two questions:

1. Does it call into `SSLWrapper`, uSockets, JS, a finalizer, or another API
   that can synchronously call back into the same object?
2. If yes, does the entry path use raw-owner / `NonNull<Self>` or only
   statement-scoped disjoint-field projections?

If the answer is "callback-capable yes, raw-owner no", it belongs in the
EXP-100/101/102/103/104 family and should get a Tree-Borrows model before
landing.
