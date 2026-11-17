import { jest, test, vi } from "bun:test";
vi.mock("./pool.mjs", async () => ({ ...(await vi.importActual<any>("./pool.mjs")), name: "mock" }));
test("the original is another run", async () => {
  console.log("SAID next to the mock", (await vi.importActual<any>("./pool.mjs")).run, jest.requireActual<any>("./pool.mjs").run);
});
