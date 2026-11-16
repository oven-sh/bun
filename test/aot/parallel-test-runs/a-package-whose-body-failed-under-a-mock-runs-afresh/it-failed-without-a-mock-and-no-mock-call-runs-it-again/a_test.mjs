import { test, vi, mock } from "bun:test";
const tried = async () => { try { return (await import("./lamp.mjs")).seen(); } catch (error) { return "threw " + error.message; } };
test("a", async () => {
  console.log(await tried(), globalThis.bodies);
  globalThis.ready = true;
  vi.doMock("wick", () => ({ width: "mocked" }));
  console.log(await tried(), globalThis.bodies);
  console.log(await tried(), globalThis.bodies);
});
