import { mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("first", await import("pack").then(it => it.light, error => error.message), "runs", process.env.PACK_RUNS);
  process.env.PACK_READY = "yes";
});
