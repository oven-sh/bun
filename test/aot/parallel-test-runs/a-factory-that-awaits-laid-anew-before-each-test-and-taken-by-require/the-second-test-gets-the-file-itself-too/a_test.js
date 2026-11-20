import { beforeEach, test, vi } from "bun:test";
beforeEach(async () => {
  vi.mock("./wick.cjs", async original => ({ ...(await original()), width: vi.fn(() => "mock") }));
});
const see = () => {
  const wick = require("./wick.cjs");
  console.log(require("./lamp.cjs").seen(), wick.width(), wick.length, wick.width.mock?.calls.length ?? "-", globalThis.bodies);
};
test("first", see);
test("second", see);
