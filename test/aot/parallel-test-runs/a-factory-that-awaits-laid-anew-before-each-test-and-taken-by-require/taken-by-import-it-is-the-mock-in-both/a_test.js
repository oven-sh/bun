import { beforeEach, test, vi } from "bun:test";
beforeEach(async () => {
  vi.mock("./wick.cjs", async original => ({ ...(await original()), width: vi.fn(() => "mock") }));
});
const see = async () => {
  const wick = await import("./wick.cjs");
  console.log((await import("./lamp.cjs")).seen(), wick.width(), wick.length, wick.width.mock?.calls.length ?? "-", globalThis.bodies);
};
test("first", see);
test("second", see);
