// A module object that goes into a list, and from there to another file, shows the files that its file has required and the file that required it.
// The files name `children` and `parent`, so the files around the module object are kept the first time: the program is compiled once.
// STATISTIC: EngineRuns = 1
const describe = require("./describe.cjs");
require("./child.cjs");

let found;
for (const each of [module]) found = each;
console.log(describe(found));
console.log(describe(found.children[1]));
console.log(found.children[1].children[0].parent === found.children[1], found.children[1].parent === module, require.main === found);
