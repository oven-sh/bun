import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
test("a", async () => {
  console.log("required", show(require("./data.toml")));
  vi.doMock("./data.toml", () => ({ v: "mock" }));
  console.log("actual", show(jest.requireActual("./data.toml")), (await import("./data.toml")).v);
});
