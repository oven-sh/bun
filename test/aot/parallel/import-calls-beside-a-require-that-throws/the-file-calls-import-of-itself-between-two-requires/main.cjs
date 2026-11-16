// The call of the file's first run and the one behind it are both in flight when the file throws a second time. Whichever text comes first runs the file, the other one allows the last require() a third run.
(async () => {
  globalThis.calls = [];
  try { require("./thrower.cjs"); } catch (error) { console.log("require threw", error.message); }
  const calls = [...globalThis.calls, import("./thrower.cjs").catch((error) => error.message)];
  console.log((await Promise.all(calls)).join(", "));
  try { require("./thrower.cjs"); } catch (error) { console.log("require threw", error.message); }
  console.log("runs", globalThis.runs);
})();
