import { jest, test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID next", require("./users.ts").describePool(), jest.requireActual<any>("./pool.cjs").id, (await vi.importActual<any>("./pool.cjs")).id);
});
