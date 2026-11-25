const { test, mock, vi, jest } = require("bun:test");
const say = (at, v) => console.log("SAID", at, typeof v, v === null ? "null" : typeof v === "object" || typeof v === "function" ? Object.prototype.toString.call(v) + " " + Object.keys(v).sort().join() : String(v));
test("t", async () => {
  say("first", require("./part.cjs"));
  try { jest.doMock("./part.cjs"); } catch (error) { console.log("SAID the call threw", error.name); }
  try { say("required", require("./part.cjs")); } catch (error) { console.log("SAID the require threw", error.name); }
  await import("./part.cjs").then(all => { say("imported", all); say("its default", all.default); }, error => console.log("SAID the import threw", error.name));
});
