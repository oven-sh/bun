// The file defines a getter and a setter under its own `module.exports` and stores through them: both are heard inside the file, and whoever requires it gets what the getter answers.
const lib = require("./lib.cjs");
console.log(globalThis.heard.join(), JSON.stringify(lib), JSON.stringify(require("./lib.cjs")), globalThis.heard.join());
