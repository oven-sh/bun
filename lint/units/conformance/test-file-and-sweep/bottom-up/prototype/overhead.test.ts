// Probe: what the test runner itself costs: the harness import and 500 tests that do nothing.
import { expect, test } from "bun:test";
const t0 = performance.now();
const { bunEnv, bunExe, isASAN, isDebug, tempDir } = await import("/workspace/wt/conformance/test/harness.ts");
const harnessMs = performance.now() - t0;
test("harness import", () => {
  console.log(`harness import ${harnessMs.toFixed(0)} ms, isDebug ${isDebug}, isASAN ${isASAN}, exe ${bunExe()}, CI ${bunEnv.CI}`);
  expect(typeof tempDir).toBe("function");
});
test.each(Array.from({ length: 500 }, (_, k) => [k]))("nothing %i", k => {
  expect(k).toBe(k);
});
