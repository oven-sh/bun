import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
vi.mock("./data.json", () => { const own = require("./data.json"); console.log("factory", show(own)); return { v: "mock " + own.v }; });
test("a", async () => {
  console.log("required", require("./data.json").v);
  vi.doUnmock("./data.json");
  console.log("behind", show(require("./data.json")), show(await import("./data.json")));
});
