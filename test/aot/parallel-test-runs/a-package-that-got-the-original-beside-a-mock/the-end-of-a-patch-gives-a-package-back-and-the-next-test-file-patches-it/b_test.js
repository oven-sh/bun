import { test, vi, mock } from "bun:test";
test("y", async () => {
  const { held, p } = await import("pkg"); console.log("SAID next", held(), await p());
  mock.module("dep", () => ({ x: "of b" })); console.log("SAID patched", (await import("dep")).x, held(), await p());
});
