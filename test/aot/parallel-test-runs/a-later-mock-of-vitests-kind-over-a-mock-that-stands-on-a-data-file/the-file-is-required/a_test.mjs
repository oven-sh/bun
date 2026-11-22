import { vi, jest, mock, test } from "bun:test";
vi.mock("./part.json", () => ({ a: "first", default: { a: "first" } }));
const ask = at => { try { console.log("SAID", at, String(require("./part.json").a)); } catch (error) { console.log("SAID", at, "threw", error.name); } };
test("t", async () => {
  ask("first");
  try { vi.doMock("./part.json", () => { throw new RangeError("of the factory"); }); console.log("SAID the call returns"); } catch (error) { console.log("SAID the call threw", error.name); }
  ask("behind");
  ask("again");
});
