import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
vi.mock("./data.toml", () => { const own = require("./data.toml"); console.log("factory", show(own)); return { v: "mock " + own.v }; });
test("a", () => {
  console.log("required", require("./data.toml").v);
  console.log("actual", show(jest.requireActual("./data.toml")));
});
