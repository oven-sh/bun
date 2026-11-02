const names = ["internal/streams/state", "internal:streams/state", "node:internal/streams/state", "internal/shared", "internal:shared", "internal/streams/readable"];
const ways = {
  require: name => require(name),
  import: name => import(name),
  getBuiltinModule: name => process.getBuiltinModule(name),
  binding: name => process.binding(name),
  resolve: name => require.resolve(name),
  isBuiltin: name => require("node:module").isBuiltin(name),
};
module.exports = (async () => {
  for (const [way, ask] of Object.entries(ways)) {
    const answers = [];
    for (const name of names) {
      try {
        const answer = await ask(name);
        answers.push(answer === undefined ? "undefined" : typeof answer === "object" ? "AN OBJECT" : String(answer));
      } catch (error) {
        answers.push(error.name);
      }
    }
    console.log(way, answers.join(" "));
  }
  console.log("listed", require("node:module").builtinModules.filter(name => name.includes("internal")).join() || "none");
  const state = require("node:stream").Readable.from([1])._readableState;
  console.log("symbols of a state", Object.getOwnPropertySymbols(state).length > 0);
})();
