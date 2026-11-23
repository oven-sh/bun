import { mock, test, vi } from "bun:test";
test("a", async () => {
  try { require("pack"); } catch (error) { console.log("first", error.message, "runs", process.env.PACK_RUNS); }
  process.env.PACK_READY = "yes";
  mock.module("pack", () => ({ light: "stand-in" }));
  console.log("then", await import("pack").then(it => it.light, error => error.message), "runs", process.env.PACK_RUNS);
});
