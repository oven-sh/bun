const { test, vi } = require("bun:test");
const late = async at => {
  let es;
  try {
    es = (await import("./user.mjs")).seen();
  } catch (error) {
    es = error.name;
  }
  console.log("SAID", at, es, globalThis.runsOfLib ?? 0, globalThis.runsOfDep ?? 0);
};
test("t", async () => {
  vi.doMock("./lib.cjs", () => { throw new RangeError("late"); });
  vi.doMock("./dep.cjs", () => ({ d: "mocked" }));
  await late("in front");
  delete require.cache[require.resolve("./lib.cjs")];
  vi.doUnmock("./dep.cjs");
  vi.doUnmock("./lib.cjs");
  await late("behind the end");
});
