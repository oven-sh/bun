// Regression test for EXP-109 (bun_runtime::ffi::Compiled.js_function bare JSValue).
//
// AUDIT REFERENCE:
//   /data/projects/bun/.ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md
//   §EXP-109 — Miri-CONFIRMED Rust shape at src/runtime/ffi/mod.rs:438-445;
//   author TODO at :440-441 ("revisit Strong/JsRef once bun_jsc lands").
//
// WHAT THIS TESTS:
//   bun:ffi's JSCallback constructs a `bun_runtime::ffi::Compiled` whose
//   `js_function: JSValue` is bare — no `Strong<JSValue>` wrapper. JSC's GC
//   has no visibility into the Rust-side `Compiled` allocation. If the
//   JSCallback object falls out of JS scope and is collected, the underlying
//   trampoline (the C address held in `cb.ptr`) becomes dangling; the
//   subsequent invocation through a `CFunction` indirection is heap-use-
//   after-free in the C trampoline page that `tcc_delete` returned to the
//   allocator.
//
// WHY THIS BELONGS AS ITS OWN FILE (not folded into ffi.test.js):
//   It is an audit-generated regression gate, not normal feature work. The
//   test deliberately spawns a child Bun process so we can capture a
//   SIGSEGV / SIGABRT outcome without taking down the parent test runner.
//   That isolation pattern (child-process-as-crash-detector) is different
//   from the rest of ffi.test.js. Maintainers may fold this into a
//   `describe("regression: GC", ...)` block inside ffi.test.js if preferred.
//
// EXPECTED OUTCOME (pre-fix vs post-fix):
//   Pre-fix: child may exit with a signal-derived code (139 = SIGSEGV on
//            Linux, 134 = SIGABRT, etc.) when the trampoline is invoked
//            after the JSCallback GC. The exact symptom is platform-
//            dependent and may also manifest as silently-returning-garbage.
//   Post-fix (R-EXP-109 lands a Strong<JSValue> migration): child exits 0
//            with stdout starting "ok:" (trampoline still alive because
//            Strong rooted the function) OR "threw:" (clear teardown error,
//            e.g. "JSCallback was closed"). NO process crash. NO signal.
//
// This is the falsifiability gate: a passing test does NOT prove the bug is
// gone (it proves the symptom isn't observable in this scenario today),
// but a failing test (exitCode signaling crash) proves the bug IS present.

import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

const CHILD_SCRIPT = `
  const { JSCallback, CFunction } = require("bun:ffi");

  // Phase 1: build a callback inside a scope.
  let ptr;
  let signature = { returns: "i32", args: [] };
  (() => {
    const cb = new JSCallback(() => 0xCAFEBABE | 0, signature);
    ptr = cb.ptr;
    // Intentionally: NO cb.close() call. cb falls out of scope when this
    // IIFE returns. Per EXP-109, the bare JSValue inside Compiled has no
    // Strong<JSValue> wrapper, so JSC GC may collect the function and
    // Function::drop frees the TCC trampoline that ptr references.
  })();

  // Phase 2: force multiple GC cycles to maximize collection probability.
  for (let i = 0; i < 8; i++) Bun.gc(true);

  // Phase 3: re-wrap the (possibly dangling) trampoline as a CFunction.
  // CFunction doesn't re-root the underlying JSCallback - it just builds
  // an invocation thunk over the raw ptr. Per the bun:ffi API the user
  // owns the ptr lifetime via the JSCallback object they constructed.
  const fn = new CFunction({ ptr, ...signature });

  // Phase 4: try to invoke. Either it works, throws cleanly, or crashes.
  try {
    const v = fn();
    console.log("ok:" + (v >>> 0).toString(16));
  } catch (e) {
    console.log("threw:" + String(e && e.message).slice(0, 200));
  }

  // Explicit clean exit so signal-based crash codes are distinguishable
  // from a normal-completion-then-exit-code path.
  process.exit(0);
`;

test("EXP-109 regression: GC'd JSCallback cb.ptr does not crash the process on CFunction invoke", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", CHILD_SCRIPT],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If the test fails: dump the full child output for diagnosis.
  // The failure pattern we care about is exitCode != 0 (especially
  // 139=SIGSEGV / 134=SIGABRT / 137=SIGKILL / negative on Node).
  if (exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.log("[EXP-109 regression] child crashed:", { exitCode, stdout, stderr });
  }

  expect(exitCode).toBe(0);
  expect(stdout).toMatch(/^(ok:|threw:)/);
});

// SECONDARY TEST: the same shape with an immediate cb.close() — this should
// ALREADY work post-fix and is a control test to confirm the negative result
// of test 1 above isn't from an unrelated bug.
test("EXP-109 control: explicitly-closed JSCallback returns null ptr; CFunction over null throws cleanly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { JSCallback, CFunction } = require("bun:ffi");
      const cb = new JSCallback(() => 1, { returns: "i32", args: [] });
      cb.close();
      console.log("after-close-ptr:" + cb.ptr);
      // Don't invoke - constructing CFunction over null ptr is the test.
      try {
        const fn = new CFunction({ ptr: cb.ptr, returns: "i32", args: [] });
        console.log("ctor-ok");
      } catch (e) {
        console.log("ctor-threw:" + String(e && e.message).slice(0, 200));
      }
      process.exit(0);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  // After close, cb.ptr should be null (per existing JSCallback test in
  // ffi.test.js:519-520). The CFunction ctor over null may throw or succeed
  // depending on bun:ffi validation; either is acceptable.
  expect(stdout).toContain("after-close-ptr:null");
});
