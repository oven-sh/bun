import { test, vi } from "bun:test";
import { both } from "./index.ts";
vi.mock("lib", async original => {
  console.log("SAID the factory begins");
  return { ...(await original()), version: "mocked" };
});
test("the package keeps the original, the program gets the mock", async () => {
  console.log("SAID", both());
});
