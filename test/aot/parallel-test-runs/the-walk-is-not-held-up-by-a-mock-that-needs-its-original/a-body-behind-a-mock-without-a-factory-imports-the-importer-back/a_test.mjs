import { test, vi, mock, jest } from "bun:test";
vi.mock("./pump.mjs");
test("t", async () => {
  const lamp = await import("./lamp.mjs");
  console.log(lamp.s, globalThis.side, typeof (await import("./pump.mjs")).f);
});
