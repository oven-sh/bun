// The folder beside the own one begins as the own one is called: `.../tool/cli` is cut off `.../tool/cli-extras/first.cjs`, and what is left is no path from the own folder.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const path = require("node:path");
const name = process.argv.length > 9 ? process.argv[9] : "first";
console.log(require(path.join(__dirname, "../cli-extras", name + ".cjs")).said);
