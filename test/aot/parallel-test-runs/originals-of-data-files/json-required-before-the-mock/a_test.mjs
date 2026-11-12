import { jest, mock, test, vi } from "bun:test";
const show = it => Object.keys(it).sort().join() + " " + it.v;
test("a", async () => {
  console.log("required", show(require("./data.json")));
  vi.doMock("./data.json", () => ({ v: "mock" }));
  console.log("actual", show(jest.requireActual("./data.json")), (await import("./data.json")).v);
});
