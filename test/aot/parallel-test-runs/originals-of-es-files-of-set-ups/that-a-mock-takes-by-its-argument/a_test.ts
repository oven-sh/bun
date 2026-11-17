import { jest, test, vi } from "bun:test";
vi.mock("./pool.mjs", async (importOriginal) => ({ ...(await importOriginal<any>()), name: "mock" }));
test("the original is another run", async () => {
  console.log("SAID next to the mock", jest.requireActual<any>("./pool.mjs").run, (await vi.importActual<any>("./pool.mjs")).run);
});
