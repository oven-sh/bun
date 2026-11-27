import { jest, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", async () => ({ ...(await vi.importActual<any>("./pool.cjs")), name: "first" }));
  console.log("SAID first", jest.requireActual<any>("./pool.cjs").id);
  vi.doMock("./pool.cjs", () => ({ name: "second", id: 200 }));
  vi.doUnmock("./pool.cjs");
});
test("two", () => {
  jest.doMock("./pool.cjs", () => ({ ...jest.requireActual<any>("./pool.cjs"), name: "third" }));
  console.log("SAID third", require("./pool.cjs").id, require("./pool.cjs").name);
});
