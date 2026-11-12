import { jest, mock, test, vi } from "bun:test";
vi.mock("./dep.mjs", () => ({ name: word }));
const word = "mock";
test("b", async () => {
  console.log("b", (await import("./user.mjs")).seen(), (await vi.importActual("./dep.mjs")).name);
});
