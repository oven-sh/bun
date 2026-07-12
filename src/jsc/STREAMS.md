# Web Streams in Bun

Bun's WHATWG Streams implementation (`ReadableStream`, `WritableStream`, `TransformStream`,
their controllers/readers/writers, `TextEncoderStream`/`TextDecoderStream`, and the
`ByteLength`/`Count` queuing strategies) is written entirely in C++ under
`src/jsc/bindings/webcore/streams/` — 33 translation units, zero JavaScript builtins.

Each TU owns one spec object or one spec algorithm group. Public classes
(`JSReadableStream.cpp`, `JSWritableStream.cpp`, …) hold the per-instance state and the
prototype/constructor tables; the abstract-operation files (`ReadableStreamOperations.cpp`,
`WritableStreamOperations.cpp`, `TransformStreamOperations.cpp`, `WebStreamsMisc.cpp`) hold
the cross-object spec algorithms. `WebStreamsInternals.h` declares every internal operation
with a `// userJS: yes/no` annotation stating whether it can re-enter user JavaScript;
`StreamsForward.h` holds the forward declarations and every kind/state enum.

## State model

Spec-internal slots (`[[state]]`, `[[queue]]`, `[[storedError]]`, `[[controller]]`, …) are
C++ members on the JSC cell — plain fields for POD state, `JSC::WriteBarrier<>` for anything
that references the JS heap. There are no JS private properties. Every class with barriers
implements `visitChildrenImpl` (declared in the same header as the fields); when adding a
field, add it to the visitor in the same change.

## No per-instance algorithm closures

The spec describes `[[pullAlgorithm]]`, `[[cancelAlgorithm]]`, etc. as closures captured at
construction. Bun does not store closures. Instead:

- Each controller carries a **kind tag** (`SourceKind`, `SinkKind`, `TransformerKind` in
  `StreamsForward.h`) plus an `m_algorithmContext` cell. Algorithm invocation is a total
  `switch` over the kind — user `underlyingSource` methods, tee branches, transform halves,
  cross-realm transfers, and Bun's native sources are all arms of the same switch.
- Promise reactions and deferred jobs go through **`JSStreamsRuntime`**
  (`JSStreamsRuntime.{h,cpp}`), a single per-global cell reached via
  `globalObject->streamsRuntime()`. It lazily materializes one shared `JSFunction` per
  reaction handler; handlers are registered with
  `promise->performPromiseThenWithContext(vm, global, onFulfilled, onRejected, result, contextCell)`
  and receive their context cell as `argument(1)`. A second, smaller list of handlers is
  bound per use-site via `JSBoundFunction` for objects we don't control. Both lists are
  closed sets — see the header comment in `JSStreamsRuntime.h` before adding one. Capturing
  `JSNativeStdFunction`s and per-stream `JSFunction`s are not used anywhere in the subsystem.

## The Bun layer

Everything Bun adds beyond the spec lives beside the spec code and is tagged, not subclassed:

- **`BunStreamMode` + `ControllerKind` + lazy materialization** (`JSReadableStream.{h,cpp}`).
  A `ReadableStream` created by native code (`Bun.file().stream()`, a fetch body, a spawned
  process's stdout) starts with no controller (`ControllerKind::None`) and a mode of
  `DirectPending` or `NativePending`; `materializeIfNeeded` installs the real controller on
  first observable use. Streams nobody reads never allocate a controller.
- **The direct controller** (`JSDirectStreamController.{h,cpp}`, `DirectSinkKind`). Bun's
  `type: "direct"` streams get a dedicated controller with an ArrayBuffer/text/array sink
  instead of the spec queue.
- **The native source adapter** (`BunStreamSource.{h,cpp}`). Bridges a native (Rust) source
  onto a default controller as `SourceKind::Native`, including the pull/backpressure
  handshake and BYOB-style chunk-size negotiation.
- **Consumer fast paths** (`BunStreamConsumers.{h,cpp}`). `Bun.readableStreamTo{Text,Bytes,
Blob,JSON,Array,ArrayBuffer,FormData}` and the `Request`/`Response` body consumers. Fully
  buffered or native-backed bodies short-circuit; only genuinely streaming JS sources pay
  for a read loop.
- **The extern "C" surface** (`WebStreamsExports.cpp`). Every function the Rust runtime
  calls into the streams subsystem (creating/cancelling/draining streams, attaching sinks,
  querying tags) is declared here and only here. `GlobalObject::assignToStream` and the
  generated `*JSSink` classes (`src/codegen/generate-jssink.ts`) enter through it.

## Working on this code

- Edit the `.cpp`/`.h` directly and rebuild with `bun bd`. There is no codegen step for the
  stream classes themselves (only the JSSink classes are generated). For a fast per-TU
  syntax check without a full build, look up the TU's compile command in
  `build/debug/compile_commands.json` and re-run it with `-fsyntax-only`.
- Each TU compiles standalone (see `noUnifyDirs` in `scripts/build/unified.ts`): file-local
  `static` helpers are written assuming TU isolation, so don't move them into headers
  without renaming.
- Exception discipline: any call that can enter user JS needs `RETURN_IF_EXCEPTION` under a
  `ThrowScope` before its result is used. The `// userJS:` annotations in
  `WebStreamsInternals.h` are the source of truth for which operations can.
- GC discipline: new `WriteBarrier` fields must be visited; values held across a call that
  can allocate must be rooted. Prove changes with a stress test
  (`Bun.gc(true)` in a loop), not by inspection.

## References

- The WHATWG Streams spec (https://streams.spec.whatwg.org/) is the algorithm source of
  truth; function-level comments in the implementation cite its operation names.
- Tests: `test/js/web/streams/`, `test/js/web/fetch/`, and the vendored WPT subset in
  `test/js/third_party/wpt-streams/` (its `expectations.json` records the expected result
  of every subtest).
