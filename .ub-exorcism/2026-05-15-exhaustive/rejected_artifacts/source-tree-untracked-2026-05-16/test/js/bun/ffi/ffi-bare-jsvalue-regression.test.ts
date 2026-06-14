// Regression test for EXP-109 (bun_runtime::ffi::Compiled.js_function bare JSValue).
//
// AUDIT REFERENCE:
//   .ub-exorcism/2026-05-15-exhaustive/UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md
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
// WHY A DEDICATED FILE:
//   The test deliberately spawns a child Bun process so we can capture a
//   SIGSEGV / SIGABRT outcome without taking down the parent test runner.
//   That child-process-as-crash-detector pattern is materially different
//   from the rest of ffi.test.js. Maintainers may fold this into a
//   `describe("regression: GC", ...)` block inside ffi.test.js if preferred.
//
// EXPECTED OUTCOME (pre-fix vs post-fix):
//   Pre-fix: child may exit with a signal-derived code (139 = SIGSEGV on
//            Linux, 134 = SIGABRT, etc.) when the trampoline is invoked
//            after the JSCallback GC.
//   Post-fix (R-EXP-109 lands a Strong<JSValue> migration): child exits 0
//            with stdout starting "ok:" or "threw:". NO process crash.

import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

const CHILD_SCRIPT = `
  const { JSCallback, CFunction } = require("bun:ffi");
  let ptr;
  let signature = { returns: "i32", args: [] };
  (() => {
    const cb = new JSCallback(() => 0xCAFEBABE | 0, signature);
    ptr = cb.ptr;
    // Intentionally: NO cb.close() call. cb falls out of scope.
  })();
  // Force multiple GC cycles to maximize collection probability.
  for (let i = 0; i < 8; i++) Bun.gc(true);
  const fn = new CFunction({ ptr, ...signature });
  try {
    const v = fn();
    console.log("ok:" + (v >>> 0).toString(16));
  } catch (e) {
    console.log("threw:" + String(e && e.message).slice(0, 200));
  }
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
  if (exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.log("[EXP-109 regression] child crashed:", { exitCode, stdout, stderr });
  }
  expect(exitCode).toBe(0);
  expect(stdout).toMatch(/^(ok:|threw:)/);
});

test("EXP-109 control: explicitly-closed JSCallback returns null ptr", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { JSCallback } = require("bun:ffi");
      const cb = new JSCallback(() => 1, { returns: "i32", args: [] });
      cb.close();
      console.log("after-close-ptr:" + cb.ptr);
      process.exit(0);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain("after-close-ptr:null");
});
