// url.parse() looks at four frames for a caller in node_modules. A frame of one of Bun's own modules takes one of the four and does not decide.
const { under } = require("lib");
const warnings = [];
process.on("warning", warning => warnings.push(warning.code));
const emitted = () => new Promise(resolve => setImmediate(() => resolve(warnings.splice(0))));

(async () => {
  for (const depth of [1, 2, 3]) {
    under(depth);
    console.log(depth + " frames of node:async_hooks above the package: " + JSON.stringify(await emitted()));
  }
})();
