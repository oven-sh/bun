import { vi, jest, mock, test } from "bun:test";
vi.mock("./part.json", () => ({ a: "first", default: { a: "first" } }));
const look = async at => console.log("SAID", at, await import("./part.json").then(all => String(all.a) + " " + String(all.default?.a), error => "threw " + error.name));
test("t", async () => {
  await look("first");
  try { vi.doMock("./part.json", () => ({ a: "second", default: { a: "second" } })); console.log("SAID the call returns"); } catch (error) { console.log("SAID the call threw", error.name); }
  await look("behind");
  await look("again");
  vi.doUnmock("./part.json");
  await look("unmocked");
});
