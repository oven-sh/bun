// url.parse() emits DEP0169 once, for the application. A package in node_modules gets none: not for a call of its own, and not where a built-in calls url.parse for it.
const url = require("node:url");
const { shapes } = require("lib");
const warnings = [];
process.on("warning", warning => warnings.push(warning.code));
const emitted = () => new Promise(resolve => setImmediate(() => resolve(warnings.splice(0))));

(async () => {
  for (const [name, call] of Object.entries(shapes)) {
    call();
    console.log(name + ": " + JSON.stringify(await emitted()));
  }
  url.parse("http://example.com/");
  console.log("the application: " + JSON.stringify(await emitted()));
  for (const call of Object.values(shapes)) call();
  url.parse("http://example.com/");
  console.log("after the warning: " + JSON.stringify(await emitted()));
})();
