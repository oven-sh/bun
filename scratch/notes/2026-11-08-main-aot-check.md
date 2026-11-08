# The counter's accessor on main after the AOT rewrite (2026-11-08)

Main 2596ac5d39 (#47942, 35,875 files) has a new table of built-ins. Every `$bindgen` function gets a row in it.
This note records a trial of PR B's accessor wiring on that tree. It is not a result for the PR. Run all of it again
after #46528 merges.

## The trial tree

main 2596ac5d39 plus:

- `src/lsquic_sys/lib.rs`: `pub safe fn lsquic_stream_frame_header_waits(stream_credit: c_int) -> c_ulong;`
  (the hunk of d0b69cdb97 applies with offset 40)
- `src/runtime/node/quic/mod.rs`: the two functions (hunk applies)
- `src/js/internal-for-testing.ts`: `lsquicFrameHeaderWaits` (hunk applies)
- `src/runtime/node/quic/quic.bind.ts`: by hand. Main has no `SocketAddress` import line there, so hunk 1 of
  d0b69cdb97 does not apply to main alone. `export default b.module({ rustPath: "crate::node::quic" });` goes after
  the first import. The two `b.fn({ returns: b.f64 })` go at the end.
- a stub in `packages/bun-usockets/src/quic.c` (trial only):
  `unsigned long lsquic_stream_frame_header_waits(int stream_credit) { (void) stream_credit; return 0; }`

## Results (debug build, 38 min cold)

- The build passes with no entry in `src/codegen/builtins/host/features-*.builtins.ts`. A binding that only
  `internal-for-testing.ts` names gets the feature `InternalForTesting` by default
  (`collectUsesOfBindingsForTests` in `src/codegen/builtins/collect-native-bindings.ts`).
- `lsquicFrameHeaderWaits.connection()` and `.stream()` return 0 (the stub).
- The rows: `native:Bindgen:quic.bind.ts:frameHeaderConnectionWaits` and `...StreamWaits`. Result `Number`,
  capability `none`, throws false, reads and writes `ExternalState` (the default of
  `src/codegen/builtins/collect-bindgen.ts:429`), `isProvenByConstruction` true. Precedent with the same defaults:
  `h3LiveCounts` in `src/http_jsc/headers_jsc.bind.ts`.
- `test/aot/builtins/differential.test.ts` with `AOT_BUILTINS_UPDATE=1 AOT_BUILTINS_FILTER=frameHeader`: the 4
  overloads pass, and `differential/not-checked.txt` does not change. Without `AOT_BUILTINS_UPDATE` a debug or ASAN
  build calls no overload (`callsOverloads = isGlibc && !isASAN && !isDebug`).
- `test/aot/builtins/native-contract.test.ts` with the same filter: nothing to check (the rows have a declaration).
- `test/internal/trim/{features,generated-features,builtin-uses,declared-uses,table,generated-guards,feature-grammar}.test.ts`:
  209 pass.
- `test/internal/builtins-table/`: 118 pass, 1 skip, 8 fail. The 8 are time limits of runs that start the whole
  generator or compile an engine (300 s, 5 s) and the tests that wait for those. None names the new rows.
  `native-binding-rows.test.ts` 6 pass, `host-uses.test.ts` 15 pass.
- `test/aot/builtins/proven-returns.test.ts` and `module-exports.test.ts` with `--timeout 900000`: 9 pass.
  With the default 5 s they time out on a debug build.
- `test/integration/bun-types/bun-types.test.ts` has `"quic.bind.ts": null` already.
- Not from this change: `test/aot/builtins/realm-agreement.test.ts` "the table lists every own name of the global
  object of an executable" fails 2 of 4 runs with an ASAN SEGV in
  `JSC::AOT::Typed::SetsOfFourInLinkFlow::numberOf` (AOTLinkFlow.h:248) on a worker thread of
  `bun build --compile --aot`. The other 2 runs pass. FFI rows of
  `rows-of-the-host-are-held-by-calls-written-by-hand.test.ts` fail on this build too.

## How to run these tests in the container

The tests need the engine's generators. There is no `vendor/WebKit` checkout. Use the prebuilt one:

    export AOT_ENGINE_DIRECTORY=$(ls -d /root/.bun/build-cache/webkit-*-debug-asan-aot/Source/JavaScriptCore/aot | tail -1)

## What it means for PR B

- No new registry entry is needed for the two functions.
- Cost line for the body: 2 more rows in the table of built-ins and 2 more host functions. Measure the bytes
  on release builds at the re-cut.
- A trial merge of main 2596ac5d39 into #46528 edb9ce8f7a has 70 conflicts. Of the files of the two prepared
  commits, `src/lsquic_sys/lib.rs` (regions at 452, 601, 827, my hunk at 180) and
  `src/runtime/node/quic/quic.bind.ts` (one region at `initStreamingSource`) are among them. Both prepared commits
  pass `git apply --check` on the rest, with the `quic.bind.ts` region resolved either way.
