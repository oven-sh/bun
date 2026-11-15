import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
vi.mock("./data.toml", () => { const own = require("./data.toml"); console.log("factory", show(own)); return { v: "mock " + own.v }; });
test("a", async () => {
  console.log("required", require("./data.toml").v);
  vi.doUnmock("./data.toml");
  console.log("behind", show(require("./data.toml")), show(await import("./data.toml")));
});
