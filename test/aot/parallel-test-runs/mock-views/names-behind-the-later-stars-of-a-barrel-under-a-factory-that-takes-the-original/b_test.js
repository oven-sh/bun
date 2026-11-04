import { test, vi } from "bun:test";
vi.mock("./barrel.js", async original => {
  await original();
  return { second: "mocked second" };
});
import { seen } from "./user.js";
test("what the mock lacks", async () => {
  console.log("by the object", seen());
  const outer = await import("./outer.js");
  console.log("by a call", outer.first, outer.second, outer.third, Object.keys(outer).sort().join("+"));
});
