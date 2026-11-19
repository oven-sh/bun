import { test } from "bun:test";
import { value } from "./a_test.mjs";
export * from "./a_test.mjs";
globalThis.mRuns = (globalThis.mRuns ?? 0) + 1;
const mRun = globalThis.mRuns;
test("m", async () => {
  console.log("SAID m", mRun, value);
  if (mRun < 2) return;
  const ns = await import("./b_test.mjs"); console.log("SAID both", mRun, value, ns.value, ns.space?.value); globalThis.bumpD?.(); console.log("SAID bumped", value, ns.value, ns.space?.value);
});
