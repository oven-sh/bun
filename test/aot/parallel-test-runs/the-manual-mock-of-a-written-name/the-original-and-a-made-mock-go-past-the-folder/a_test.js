import { jest, test, vi } from "bun:test";
test("vi.importActual, jest.requireActual, jest.createMockFromModule", async () => {
  const made = jest.createMockFromModule("./src/old.cjs");
  console.log("SAID", (await vi.importActual("./src/old.cjs")).who(), jest.requireActual("./src/old.cjs").who(), made.who(), jest.isMockFunction(made.who));
});
