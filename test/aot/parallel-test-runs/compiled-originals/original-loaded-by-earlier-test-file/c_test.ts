import { test, vi } from "bun:test";
import { go } from "./user";
vi.mock("./x", async original => {
  const real = await original();
  console.log("SAID real", real.next());
  return { ...real, rate: 7 };
});
test("the original is the loaded module", () => {
  console.log("SAID c", go());
});
