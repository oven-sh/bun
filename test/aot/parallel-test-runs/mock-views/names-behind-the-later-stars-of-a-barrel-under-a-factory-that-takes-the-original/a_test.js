import { test, vi } from "bun:test";
vi.mock("./barrel.js", async original => ({ ...(await original()), first: "mocked first", added: "added" }));
import { seen } from "./user.js";
import { byKeyOfTheRun } from "./open.js";
test("what comes through the star over the mocked barrel", async () => {
  console.log("by the object", seen());
  const outer = await import("./outer.js");
  console.log("by a call", outer.first, outer.second, outer.third, outer.added, Object.keys(outer).sort().join("+"));
  console.log(typeof byKeyOfTheRun());
});
