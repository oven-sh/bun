import { test, vi } from "bun:test";
let calls = 0;
test("a", async () => {
  console.log("first", await import("./lamp.mjs").then(it => it.look(), error => error.message), "runs", process.env.PACK_RUNS);
  process.env.PACK_READY = "yes";
  vi.doMock("pack", async original => { calls++; return { ...(await original()), light: "over" }; });
  console.log("then", await import("./lamp.mjs").then(it => it.look(), error => error.message), "runs", process.env.PACK_RUNS, "calls", calls);
});
