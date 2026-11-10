import { test, vi, mock, jest } from "bun:test";
vi.mock("./pump.mjs");
test("t", async () => {
  const roof = await import("./roof.mjs");
  console.log(roof.r, globalThis.side, typeof (await import("./pump.mjs")).f);
});
