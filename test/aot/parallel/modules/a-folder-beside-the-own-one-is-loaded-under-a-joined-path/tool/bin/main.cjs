// The entry point of a tool lies in bin/ and requires a command by its name from the folder beside it.
// `path.join` takes the `..` away, so what it makes does not begin with `__dirname`. The build gave the name up: the commands were not in the executable.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const path = require("node:path");
const name = process.argv.length > 9 ? process.argv[9] : "build";
console.log(require(path.join(__dirname, "../commands", name)).said);
