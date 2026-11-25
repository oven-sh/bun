import { jest, test, vi } from "bun:test";

test("the factory runs at once", () => {
  console.log(jest.requireActual("bun") === Bun);
  try {
    vi.doMock("bun", () => null);
    console.log("taken");
  } catch (error) {
    console.log(error.name, error.message);
  }
});
