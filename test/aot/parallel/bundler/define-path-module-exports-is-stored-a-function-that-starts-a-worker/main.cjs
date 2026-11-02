// A CommonJS file stores a function that starts a Worker from its parameter through a name whose `--define` value is `module.exports`, and this file calls what it requires with a URL: the build compiles the file of the URL.
// Flags: --define OWN=module.exports
const start = require("./tools.cjs");
const worker = start(require("node:url").pathToFileURL(__dirname + "/w.mjs"));
worker.onmessage = event => (console.log(event.data), worker.terminate());
worker.onerror = event => console.log("error:", String(event.message).split("\n")[0]);
