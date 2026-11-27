import { test, vi } from "bun:test";
import { both } from "./index.ts";
vi.mock("lib", async () => {
  console.log("SAID the factory begins");
  return { ...(await vi.importActual("lib")), version: "mocked" };
});
test("the package keeps the original, the program gets the mock", async () => {
  console.log("SAID", both());
});
