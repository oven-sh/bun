const { test, vi } = require("bun:test");
const lib = require.resolve("./lib.cjs");
const user = require.resolve("./user.mjs");
const ask = async () => {
  try {
    return (await import("./user.mjs")).seen();
  } catch (error) {
    return error.name;
  }
};
const fails = () => {
  throw new RangeError("the factory");
};
async function run(at) {
  delete require.cache[user];
  delete require.cache[lib];
  vi.doMock("./lib.cjs", async () => {
    await 0;
    throw new RangeError("the factory");
  });
  try {
    require("./lib.cjs");
  } catch {}
  const front = await ask();
  delete require.cache[lib];
  vi.doUnmock("./lib.cjs");
  const behind = await ask();
  console.log("SAID", at, "word", front, behind);
  console.log("SAID", at, "runs", globalThis.runsOfLib);
}
test("t", async () => {
  await run("first");
  await run("second");
});
