// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const os = require("node:os");
const load = name => [require].map(one => one(name))[0];
console.log(typeof load("node:os").EOL, load("node:os") === os);
