import { jest, test, vi } from "bun:test";
const config = require("./config.cjs");
vi.mock("./reader.mjs", () => ({ ...jest.requireActual("./reader.mjs"), more: 1 }));
test("t", () => {
  const reader = require("./reader.mjs");
  console.log("SAID", reader.look(), reader.more, config.level);
});
