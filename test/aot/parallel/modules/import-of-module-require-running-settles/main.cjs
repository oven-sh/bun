// require() runs a module, which requires a second one, which calls import() on the first. The promise settles when the first module has run.
process.on("exit", () => console.log(globalThis.state));
require("./running.mjs");
