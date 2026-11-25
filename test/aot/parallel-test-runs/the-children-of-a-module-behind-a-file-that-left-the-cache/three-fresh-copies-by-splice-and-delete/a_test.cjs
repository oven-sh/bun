const { test, vi, jest, mock } = require("bun:test");
const say = (step, ...all) => console.log("SAID", step, "runs", globalThis.runsOfLib ?? 0, ...all, process.argv.length > 9);
const key = require.resolve("./lib.cjs");
test("t", async () => {
  require("./lib.cjs");
  const lengths = [module.children.length];
  const fresh = () => { const old = require.cache[key]; module.children.splice(module.children.indexOf(old), 1); delete require.cache[key]; return require("./lib.cjs"); };
  for (let turn = 0; turn < 3; ++turn) { fresh(); lengths.push(module.children.length); }
  say("lengths", lengths.join());
});
