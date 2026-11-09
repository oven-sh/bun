import { test, mock } from "bun:test";
mock.module("./q.mjs", () => ({ ns: { fake: 1 } }));
test("a", async () => {
  const p = await import("./p.mjs");
  console.log("a", typeof p.ns, String(p.ns.fake), Object.keys(p).join());
});
