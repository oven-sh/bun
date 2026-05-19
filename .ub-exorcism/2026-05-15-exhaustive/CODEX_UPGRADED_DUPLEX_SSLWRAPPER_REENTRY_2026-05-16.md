# Codex UpgradedDuplex / SSLWrapper Re-entry Sweep — 2026-05-16

Purpose: record the EXP-100 promotion and, just as importantly, why the
nearby `ProxyTunnel` implementation contains the correct raw-owner /
disjoint-field contrast pattern. Later EXP-101/102/103 correct one overbroad
claim in this note: `ProxyTunnel` is not wholly clean because
`shutdown(&mut self)`, `write(&mut self, buf)`, `on_writable(&mut self, ...)`,
and `receive(&mut self, ...)` still use stale receiver-wrapper shapes.

## Source Shape

`src/runtime/socket/UpgradedDuplex.rs` embeds:

- `wrapper: Option<SSLWrapper<*mut UpgradedDuplex>>` at lines 27-44.
- SSLWrapper handler callbacks at lines 101-146. Each callback receives
  `ctx: *mut UpgradedDuplex` and immediately materializes `&mut UpgradedDuplex`.
- `on_close` calls `teardown()`, and `teardown()` writes
  `self.wrapper = None` at line 485.
- Callback-facing exports at lines 202-216, 304-390, and 587-599 call
  `SSLWrapper::{flush,start,write_data,shutdown,receive_data}` through
  `&mut self` / `&mut self.wrapper`.
- `src/uws_sys/lib.rs:191-201` exposes several of those methods as safe opaque
  handle methods taking `&mut UpgradedDuplex`.

That means an exported `UpgradedDuplex::close(&mut self)` can borrow
`&mut self.wrapper`, call `SSLWrapper::shutdown`, and then the synchronous
SSLWrapper close callback re-enters through `ctx: *mut UpgradedDuplex` and
creates a fresh `&mut UpgradedDuplex` that overlaps the still-live receiver
borrow.

## Experiment

Path:
`experiments/EXP-100/`

Invocation:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-100
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run \
  2>&1 | tee ../../phase5_experiment_results/EXP-100.log
```

Observed signal:

```text
error: Undefined Behavior: write access through <...> is forbidden
  --> src/main.rs:23:9
   |
23 |         this.closed = true;
   |         ^^^^^^^^^^^^^^^^^^ Undefined Behavior occurred here
   = help: the protected tag was created at `fn close(&mut self)`
```

The final witness intentionally initializes the wrapper through a raw owner
before calling `close(&mut self)`. That avoids the earlier setup artifact where
creating a stored callback pointer before assigning the wrapper field itself
invalidated the setup pointer. The retained log proves the receiver-protector /
callback-reborrow failure.

Verdict: `CONFIRMED_UB` as EXP-100.

## Why ProxyTunnel Contains The Fix Pattern

`src/http/ProxyTunnel.rs` already documents and implements the right pattern in
its callback path:

- lines 97-180: raw field accessors project only `socket`, `write_buffer`,
  `shutdown_err`, `wrapper`, or `ref_count`;
- lines 222-230: the aliasing note explicitly says SSLWrapper callbacks are
  invoked while the caller holds `&mut SSLWrapper`, so callbacks must never
  materialize `&mut ProxyTunnel`;
- lines 684-704 and selected callback paths around 752-763: wrapper calls operate through raw owner /
  wrapper-field projection while callbacks touch only fields disjoint from the
  wrapper.

`UpgradedDuplex` should adopt that same shape rather than adding only a busy
flag. A busy flag can prevent dropping the wrapper out from under itself, but
it does not remove the whole-struct `&mut UpgradedDuplex` callback reborrow
that Tree-Borrows rejects.

**EXP-101/102/103 caveat:** the later ProxyTunnel follow-up found four leftover
stale receiver wrappers: `src/http/ProxyTunnel.rs:707-711`
(`ProxyTunnel::shutdown(&mut self)`), `src/http/ProxyTunnel.rs:768-775`
(`ProxyTunnel::write(&mut self, buf)`), `src/http/ProxyTunnel.rs:714-749`
(`ProxyTunnel::on_writable(&mut self, ...)`), and
`src/http/ProxyTunnel.rs:752-765` (`ProxyTunnel::receive(&mut self, ...)`).
That does not invalidate the raw field-accessor / callback pattern above; it
means the report must cite the pattern precisely and must not describe the
whole `ProxyTunnel` type as already clean. See
`CODEX_PROXY_TUNNEL_SHUTDOWN_REENTRY_2026-05-16.md`.

## Remediation

1. Convert callback-running `UpgradedDuplex` methods to raw-owner or
   `NonNull<Self>` entry points where needed.
2. Add `wrapper_mut(this: *mut Self) -> Option<&mut WrapperType>` that projects
   only the wrapper field.
3. Change SSLWrapper callbacks to use disjoint-field accessors for
   `ssl_error`, handlers, timer, and wrapper teardown state; do not materialize
   whole-struct `&mut UpgradedDuplex` while an SSLWrapper method is on the
   stack.
4. Add an EXP-100-fix Tree-Borrows model before touching source.
