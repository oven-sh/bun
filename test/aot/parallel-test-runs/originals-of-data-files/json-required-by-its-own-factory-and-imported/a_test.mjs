import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
vi.mock("./data.json", () => { const own = require("./data.json"); console.log("factory", show(own)); return { v: "mock " + own.v }; });
test("a", async () => {
  console.log("imported", (await import("./data.json")).v);
  console.log("actual", show(jest.requireActual("./data.json")), show(await vi.importActual("./data.json")));
});
