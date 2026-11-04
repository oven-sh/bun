// The save-and-restore idiom: `"kept" in globalThis`, `delete globalThis.kept`.
import { test } from "bun:test";

const take = it => it;
test("t", () => {
  const had = "kept" in globalThis;
  const saved = globalThis.kept;
  globalThis.kept = 1;
  console.log(had, globalThis.kept);
  if (had) globalThis.kept = saved;
  else delete globalThis.kept;
  console.log("kept" in globalThis);
});
