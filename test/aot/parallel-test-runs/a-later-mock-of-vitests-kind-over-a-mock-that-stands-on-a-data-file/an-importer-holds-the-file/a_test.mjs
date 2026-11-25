import { vi, jest, mock, test } from "bun:test";
vi.mock("./part.json", () => ({ a: "first", default: { a: "first" } }));
const look = async at => console.log("SAID", at, await import("./part.json").then(all => String(all.a) + " " + String(all.default?.a), error => "threw " + error.name));
test("t", async () => {
  console.log("SAID", (await import("./user.mjs")).seen());
  try { vi.doMock("./part.json", () => { throw new RangeError("of the factory"); }); console.log("SAID the call returns"); } catch (error) { console.log("SAID the call threw", error.name); }
  console.log("SAID", (await import("./user.mjs")).seen());
  await look("behind");
});
