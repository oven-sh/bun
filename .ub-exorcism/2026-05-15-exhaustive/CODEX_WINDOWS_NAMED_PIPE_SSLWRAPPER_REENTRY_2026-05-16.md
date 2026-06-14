# Codex WindowsNamedPipe / SSLWrapper Re-entry Sweep — 2026-05-16

## Question

After EXP-100 through EXP-103 proved that `SSLWrapper`-driving methods must not carry a protected whole-struct `&mut self` receiver across synchronous callback re-entry, check whether the Windows named-pipe SSL path has the same shape.

## Source Facts

- `#[bun_uws::uws_callback]` expands `&mut self` methods by creating `&mut *__ctx.cast::<Self>()` in the generated thunk (`src/jsc_macros/lib.rs:828-843`).
- `WindowsNamedPipe` stores `wrapper: Option<SSLWrapper<*mut WindowsNamedPipe>>` and installs handlers with `ctx: std::ptr::from_mut(self)` (`src/runtime/socket/WindowsNamedPipe.rs:1028-1035`, plus the earlier init paths at `:977-980`).
- SSLWrapper callbacks materialize whole-struct mutable references again:
  - `ssl_on_open` / `ssl_on_handshake` / `ssl_on_data` / `ssl_on_close` / `ssl_write` at `src/runtime/socket/WindowsNamedPipe.rs:394-407`.
- Callback-driving methods still start from whole-struct `&mut self`; some are
  generated exports and some are internal runtime entries:
  - `on_read(&mut self)` at `:261-315` calls `(*w).receive_data(...)`.
  - `flush(&mut self)` at `:554-584` calls `(*w).flush()`.
  - `on_internal_receive_data(&mut self, ...)` at `:587-610` calls `(*w).receive_data(...)`.
  - `start_tls(&mut self, ...)` at `:1038-1052` calls `(*w).start()`.
  - `encode_and_write(&mut self, ...)` at `:1127-1152` calls `(*w).write_data(...)`.
  - `close(&mut self)` / `shutdown(&mut self)` at `:1166-1238` call `(*w).shutdown(false)`.

## What Is Already Good

`WindowsNamedPipe` has a real `WRAPPER_BUSY` guard. That guard addresses a real UAF/drop-under-wrapper hazard: `release_resources()` must not set `self.wrapper = None` while a raw `*mut WrapperType` into the `Option` payload is executing.

The important correction is that `WRAPPER_BUSY` does not also make the outer `&mut self` receiver disappear. It prevents one class of UB; it does not address the Tree-Borrows protected-receiver conflict.

## Contrast: WebSocketProxyTunnel

`src/http_jsc/websocket_client/WebSocketProxyTunnel.rs` is the clean contrast:

- The module-level aliasing contract says callback-driving entries take `*mut Self`, project only the `wrapper` field, and callbacks never form whole-struct `&mut Self`.
- `start`, `on_writable`, `receive`, `write`, and `shutdown` all take `*mut Self`.
- Callback bodies snapshot or project only disjoint fields while the caller holds `&mut SslWrapper`.

That means the audit should not say "SSLWrapper is intrinsically unsound." The precise claim is narrower: parent methods that drive `SSLWrapper` are unsound when they carry a protected whole-struct receiver across synchronous handler re-entry.

## Experiment

Added `experiments/EXP-104/` with four modes:

- `flush-bad` mirrors a generated export such as `#[uws_callback] pub fn flush(&mut self)` + `WRAPPER_BUSY` + `SSLWrapper::flush → ssl_write(ctx)`.
- `receive-bad` mirrors the internal `on_read` / `on_internal_receive_data` shape + `WRAPPER_BUSY` + `SSLWrapper::receive_data → ssl_on_close(ctx)`.
- `flush-good` keeps the same callback writes and same `WRAPPER_BUSY` logic, but enters through `NonNull<Self>`.
- `receive-good` does the same for `receive_data`.

Commands:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-104
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- flush-bad
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-bad
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- flush-good
MIRIFLAGS="-Zmiri-tree-borrows -Zmiri-ignore-leaks" cargo +nightly miri run -- receive-good
```

## Result

Confirmed:

- `phase5_experiment_results/EXP-104-flush.log` fails in `ssl_write`, with Miri reporting the protected tag was created at `fn flush_bad(&mut self)`. This is the direct representative for generated exported methods such as `flush`.
- `phase5_experiment_results/EXP-104-receive.log` fails in `ssl_on_close`, with the protected tag created at `fn receive_bad(&mut self, data: &[u8])`. This is the direct representative for the internal receive paths.
- `phase5_experiment_results/EXP-104-flush-good.log` and `EXP-104-receive-good.log` run clean.

## Defensible Claim

Promote this as EXP-104 / `CONFIRMED_UB (Tree-Borrows model)`, but phrase it carefully:

- Correct: `WRAPPER_BUSY` is necessary but insufficient; the receiver shape must become raw-owner.
- Incorrect: `WRAPPER_BUSY` itself is the bug.
- Correct: this is a Windows named-pipe SSLWrapper runtime surface.
- Incorrect: every WindowsNamedPipe method is proven UB.

## Remediation

Keep the `WRAPPER_BUSY` deferral logic. Change the callback-driving SSLWrapper entry points so exported generated thunks and internal runtime entries do not hold a whole-struct `&mut Self` while entering `SSLWrapper`. The target shape is the `WebSocketProxyTunnel` / EXP-012 family:

- raw-owner entry (`*mut Self` / `NonNull<Self>`);
- short, statement-scoped field projections;
- callbacks avoid whole-struct `&mut Self` while `&mut SSLWrapper` is live;
- `WRAPPER_BUSY` remains in place to defer wrapper teardown.
