// Each value of the name is known, and each leaves the folder of the file: the files were in the executable, and no case of the switch was what `path.join` makes.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const path = require("node:path");
console.log(require(path.join(__dirname, process.argv.length > 9 ? "../commands/serve.cjs" : "../commands/build.cjs")).said);
