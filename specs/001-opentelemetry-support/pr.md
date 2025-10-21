This PR adds a `Bun.telemetry` and a `bun-otel` package with a Bun-specific implementation of the [OpenTelemetry](https://opentelemetry.io) for `Bun.serve()` (and `Node.js http.createServer()`!), addressing issue #3775 where the native server did not work with `AsyncLocalStorage` for context propagation.

In addition, this provides a foundation for moving to full compatibility with auto instrumentation, as well as manual configuration via a `BunSDK` helper that tracks the `NodeSDK` utility's API. In the spirit of Bun's performance advantage, we've added native instrumentation hooks at each Bun-native replacement:

- Bun.serve
- fetch
- ...

# Out of scope:

## OpenTelemetry C++ SDK

This PR intentionally re-uses the existing `opentelemetry-js` (node) library for aggregating and sending telemetry for a few reasons:

- Bun aims to be Node-drop-in compatible, so it necessarily should support the same OTel library
- Using the C++ library and creating Meter and Client bindings would add 10-20mb to the bun executable (Claude's estimate, not tested)
- The scope is already huge

However, the API surfaces defined here would be perfectly amenable to providing native implementation of the collectors, with native HTTP calls etc, should someone else want to undertake this in the future!

# Architecture

This is a Significant API Evolution from the [POC](https://github.com/oven-sh/bun/pull/23798). The POC used a configure-based API with request callbacks, while the current spec uses an attach/detach pattern with operation-centric callbacks and explicit InstrumentKind types.

## Lifecycle State Machine

The native telemetry hooks follow a state machine pattern for tracking operations:

```
┌──────────────────┐
│  Operation Start │
└────────┬─────────┘
         │
         ▼
    ┌────────────────────┐
    │ onOperationStart() │ ◄── Attributes with request info
    └────────┬───────────┘
             │
             ▼
    ┌─────────────────────┐
    │ onOperationInject() │ ◄── Called if distributed tracing active
    └────────┬────────────┘     Returns headers to inject
             │
             ▼
    ┌──────────────────────┐
    │  Operation Executing │
    └────────┬─────────────┘
             │
             ▼
    ┌──────────────────────┐
    │ [0-N times]          │
    │ onOperationProgress()│ ◄── Incremental updates during execution
    └────────┬─────────────┘
             │
        ┌────┴────┐
        │         │
        ▼         ▼
   ┌─────────┐ ┌──────────┐
   │ Success │ │  Failure │
   └────┬────┘ └────┬─────┘
        │           │
        ▼           ▼
┌──────────────┐ ┌────────────────┐
│ onOpEnd()    │ │ onOpError()    │ ◄── Attributes with result/error
│              │ │                │
│ (delete id)  │ │ (delete id)    │ ◄── MUST delete from map
└──────────────┘ └────────────────┘
```
