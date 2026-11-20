# OpenTelemetry

| Crate                | What it holds                                                                           |
| -------------------- | --------------------------------------------------------------------------------------- |
| `bun_telemetry`      | ids, sampling, W3C headers, the OTLP encoder, batching. No JavaScriptCore, no transport |
| `bun_telemetry_cold` | the environment, the resource, the OTLP decoder. Built for size                         |
| `bun_telemetry_jsc`  | `Bun.otel`, the exporters, and the spans that the rest of Bun records with              |

There is no JavaScript behind `Bun.otel`, so `bun build --compile --aot` has nothing to compile for it and
`BUN_OTEL=1` works in an executable that never names it.

## Instrument an API

Add a row to `instruments!` in `src/telemetry/lib.rs` if none fits. Then pick a span by what ends the operation.

| The operation                           | Span                                                       | Example                              |
| --------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| ends in native code                     | `NativeSpan`, or `SpanCell` in a struct that takes `&self` | `subprocess.rs`, `node_fs.rs`        |
| returns a promise                       | `PromiseSpan`                                              | `global_lookup` in `dns.rs`          |
| calls a handler, which starts more work | `HeldSpan`                                                 | `on_message` in `ServerWebSocket.rs` |
| sends or answers an HTTP request        | `http_client::begin`, `http_server::*`                     | `FetchTasklet.rs`, `StaticRoute.rs`  |
| sends one from `src/js`                 | `internal/http/client_span`                                | `_http_client.ts`                    |
| queries a database                      | `db::begin`                                                | `js_valkey.rs`, `SqliteSpan.h`       |

```rust
let span = NativeSpan::start(global, Instrument::Net, SpanKind::Client, |r| {
    r.set_name(b"tcp.connect");
    r.server(host, port);
});
let result = connect();
span.settle(&result);
```

```rust
let active = span.enter(global);
let result = active.adopt(handler).call(global, this, args);
drop(active);
span.end_with_result(global, result?);
```

The call site handles none of this:

- **Tracing is off, the trace is not sampled, or the instrument needs a parent.** The span is one null word, every
  method is one branch, and no closure runs.
- **`--trim`.** The closures and everything they call leave with the feature `Telemetry`.
- **It ends twice, or never.** The first end counts. A span that is dropped is not exported.
- **Limits, repeated keys, bytes that are not UTF-8, credentials in a URL.** `Record` deals with them.
- **Errors.** `settle` takes an `Outcome`: a `bun_sys::Error`, a `SystemError`, a `Thrown` value, the
  `PendingException`, or a `Result` or `Option` of one. Describing a thrown value runs no script.
- **The VM is exiting.** The span is dropped.

A closure must not run script.

## The active span

It is a frame of the chain that `AsyncLocalStorage` keeps in the async context (`src/js/node/async_hooks.ts`), with
the `Span` or the `TelemetryContext` as its `storage`. The engine captures and restores that chain in every tier and
in compiled code. `TelemetryBindings.cpp` does to it what `run()` and `enterWith()` do.

## Memory

- A `Span` is one 112-byte cell. Activating it takes a 48-byte frame.
- An attribute is encoded as OTLP when it is set, so the span keeps no JavaScript value alive. The buffers belong
  to an 88-byte `Record`, which a span takes at its first attribute and hands back to a pool of 64 when it ends.
- `tracestate` and `baggage` are shared by all the spans below the request that brought them.
- An ended span is bytes in the one queue of the process. `maxQueueSize` bounds it, retries included.
- The span of an HTTP request waits there as the facts of the request. It is encoded, like every full batch is
  assembled, on a thread that is there while it has work.
- After a whole interval without a span the timer stops and the pooled buffers are freed.
