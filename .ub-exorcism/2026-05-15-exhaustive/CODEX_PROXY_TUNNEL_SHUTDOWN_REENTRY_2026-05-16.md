# Codex ProxyTunnel Receiver Re-entry Sweep — 2026-05-16

Purpose: record EXP-101, EXP-102, and EXP-103 and correct an over-clean
reading of ProxyTunnel after EXP-100.

## Finding

`src/http/ProxyTunnel.rs` contains the correct callback-aliasing fix model:

- `wrapper_mut(this: *mut Self)` projects only the `wrapper` field.
- callbacks avoid materializing `&mut ProxyTunnel` and instead project disjoint
  fields with `addr_of!` / `addr_of_mut!`.
- `close_raw(this: NonNull<Self>, err)` drives `wrapper.shutdown()` through
  the raw-owner path.

But the same file still has:

```rust
pub fn shutdown(&mut self) {
    if let Some(wrapper) = &mut self.wrapper {
        let _ = wrapper.shutdown(true);
    }
}
```

Live call sites:

- `src/http/lib.rs:1347-1355` (`close_proxy_tunnel`)
- `src/http/HTTPContext.rs:692-700` (close-socket path)

`SSLWrapper::shutdown()` synchronously invokes callbacks. Those callbacks use
disjoint-field raw projections, which is correct only if the caller did not
enter the SSLWrapper call while holding a whole-struct `&mut ProxyTunnel`
receiver. `shutdown(&mut self)` still does that.

## Experiment

`experiments/EXP-101/` models both paths:

- default path: `shutdown(&mut self)` -> `&mut self.wrapper` -> callback raw
  field writes
- `--good` path: raw-owner `close_raw(this)` -> wrapper-field projection ->
  callback raw field writes

Commands:

```sh
cd /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/experiments/EXP-101
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run
MIRIFLAGS="-Zmiri-tree-borrows" cargo +nightly miri run -- --good
```

Bad path result:

```text
error: Undefined Behavior: write access through <1213> at alloc199[0x10] is forbidden
help: the protected tag <1189> was created here
   --> src/main.rs:40:17
    |
 40 |     fn shutdown(&mut self) {
    |                 ^^^^^^^^^
```

Good path result: clean.

## Verdict

`CONFIRMED_UB` as EXP-101.

## Second Finding: `write(&mut self)` Is The Same Live Receiver Shape

The same source audit found a second live stale-wrapper method:

```rust
pub fn write(&mut self, buf: &[u8]) -> Result<usize, Error> {
    if let Some(wrapper) = &mut self.wrapper {
        return wrapper.write_data(buf).map_err(...);
    }
    Err(err!(ConnectionClosed))
}
```

Live call sites:

- `src/http/lib.rs:2876-2888` (`RequestStage::ProxyBody`)
- `src/http/lib.rs:2913-2947` (`RequestStage::ProxyHeaders`)

`SSLWrapper::write_data()` calls `handle_traffic()` on success, empty data, and
WANT_READ/WANT_WRITE paths (`src/uws/lib.rs:739-785`). `handle_traffic()` can
synchronously invoke `handlers.write`, `handlers.on_data`, `handlers.on_handshake`,
or `handlers.on_close`. ProxyTunnel's own comment at `src/http/ProxyTunnel.rs:483-497`
states that `write_encrypted` is fired from inside `SSLWrapper::flush/handle_traffic`
and touches fields while the caller holds `&mut SSLWrapper`.

`experiments/EXP-102/` models the bad `write(&mut self)` path and a good
raw-owner `write_raw(this, data)` control. The bad path fails under Tree
Borrows with the protected tag created at `fn write(&mut self, data: &[u8])`;
the raw-owner control runs clean.

Verdict: `CONFIRMED_UB` as EXP-102.

## Third Finding: raw-capture-first receiver methods are still protected

Follow-up source review found two more live receiver wrappers:

```rust
pub fn on_writable<const IS_SSL: bool>(&mut self, socket: HTTPSocket<IS_SSL>) {
    let this = NonNull::from(&mut *self);
    // ...
    wrapper.flush();
}

pub fn receive(&mut self, buf: &[u8]) -> Result<(), Error> {
    let this = NonNull::from(&mut *self);
    // ...
    wrapper.receive_data(buf)?;
}
```

Live call sites:

- `src/http/lib.rs:2754-2755` (`on_writable`)
- `src/http/lib.rs:3254-3258` (`receive`)

The source comment argues that taking `NonNull<Self>` first is enough because
the method does not intentionally use `self` after that point. The Tree-Borrows
model disagrees: a method with `&mut self` has already created a protected
whole-struct receiver tag for the duration of the call frame. Capturing a raw
pointer from that receiver does not end the protector.

`experiments/EXP-103/` models both bad paths and two good raw-owner controls:

- `on-writable-bad`: `on_writable(&mut self)` → raw capture → `flush()` →
  callback raw field write
- `receive-bad`: `receive(&mut self, ...)` → raw capture → `receive_data()` →
  callback raw field write
- `on-writable-good`: raw-owner `on_writable_raw(NonNull<Self>)`
- `receive-good`: raw-owner `receive_raw(NonNull<Self>, ...)`

Bad paths fail under Tree Borrows:

- `EXP-103-on-writable.log`: `reborrow through <1437> ... is forbidden`,
  protected tag created at `fn on_writable(&mut self)`.
- `EXP-103-receive.log`: `write access through <1768> ... is forbidden`,
  protected tag created at `fn receive(&mut self, ...)`.

Both raw-owner controls pass. Verdict: `CONFIRMED_UB` as EXP-103.

## Non-counted sibling: `close(&mut self, err)`

`src/http/ProxyTunnel.rs:677-681` is the same raw-capture-first wrapper shape:

```rust
pub fn close(&mut self, err: Error) {
    Self::close_raw(NonNull::from(&mut *self), err);
}
```

The follow-up source sweep did **not** find a live in-tree caller, so this note
does not promote a separate EXP or increment the confirmed-finding count. Still,
it should be deleted or made private in the same remediation PR as
EXP-101/102/103. If a future caller starts using it, the EXP-101/103 reasoning
applies: `NonNull::from(&mut *self)` does not end the protected receiver tag.

## Remediation

Do not cite ProxyTunnel as completely clean until these methods are migrated.

Recommended fix:

1. Add raw-owner entry points for all four live wrappers:
   `shutdown_raw(this: NonNull<Self>)`, `write_raw(this: NonNull<Self>, buf)`,
   `on_writable_raw<const IS_SSL: bool>(this: NonNull<Self>, socket)`, and
   `receive_raw(this: NonNull<Self>, buf)`.
2. Replace `tunnel.shutdown()`, `ProxyTunnel::write(proxy, ...)`,
   `proxy.on_writable::<IS_SSL>(socket)`, and
   `proxy_tunnel_mut().unwrap().receive(incoming_data)` call sites with
   raw-owner calls while the intrusive ref keeps the tunnel live.
3. Delete or make private the old `shutdown(&mut self)`, `write(&mut self, ...)`,
   `on_writable(&mut self, ...)`, and `receive(&mut self, ...)` methods.
   Also remove or privatize the unused same-shaped `close(&mut self, err)`
   wrapper so it cannot become the next stale entry path.
4. Keep the existing callback discipline: callbacks must not materialize
   whole-struct `&mut ProxyTunnel`.

This sits in the same remediation family as EXP-026, EXP-099, and EXP-100.
