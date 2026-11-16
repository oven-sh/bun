import { jest, mock, test, vi } from "bun:test";
vi.mock("./dep.mjs", async importOriginal => ({ ...(await importOriginal()), name: word }));
const word = "mock";
test("b", async () => {
  console.log("b", (await import("./user.mjs")).seen(), jest.requireActual("./dep.mjs").name);
});
