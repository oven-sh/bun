const { jest, test } = require("bun:test");
test("the new factory imports the module while it runs at the call", async () => {
  const before = globalThis.callsOfThePreloadsFactory;
  let look;
  jest.doMock("./lib.mjs", () => { look = import("./lib.mjs").then(() => "fulfilled", error => error.constructor.name); return { a: 1 }; });
  const heard = await look;
  console.log("SAID", heard, globalThis.callsOfThePreloadsFactory - before, require("./lib.mjs").a);
});
