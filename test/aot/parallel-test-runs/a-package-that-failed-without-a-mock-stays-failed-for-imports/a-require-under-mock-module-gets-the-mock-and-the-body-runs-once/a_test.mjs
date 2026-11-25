import { mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("first", await import("pack").then(it => it.light, error => error.message), "runs", process.env.PACK_RUNS);
  process.env.PACK_READY = "yes";
  mock.module("pack", () => ({ light: "stand-in" }));
  console.log("then", require("pack").light, "runs", process.env.PACK_RUNS);
  console.log("again", require("pack").light, "runs", process.env.PACK_RUNS);
});
