import { test } from "bun:test";
import { value } from "./a_test.mjs";
export { value, bump } from "./a_test.mjs";
globalThis.mRuns = (globalThis.mRuns ?? 0) + 1;
const mRun = globalThis.mRuns;
test("m", async () => {
  console.log("SAID m", mRun, value);
  if (mRun < 3) return;
  const ns = await import("./b_test.mjs"); console.log("SAID ns", mRun, ns.value, ns.space?.value, Reflect.get(ns, "value"));
});
