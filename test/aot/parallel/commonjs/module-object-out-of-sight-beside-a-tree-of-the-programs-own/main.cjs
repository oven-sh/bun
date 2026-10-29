// A module object goes into a list, and nobody reads `children` or `parent` of it: the objects that are asked for members of these names are the program's own.
// The names are a guess that the files around the module object are asked for. The engine says that they are not, and the program is compiled again without them.
// STATISTIC: EngineRuns = 2
// STATISTIC: WholeEngineRuns = 1
const { name } = require("./child.cjs");

const tree = { name: "root", parent: null, children: [] };
tree.children.push({ name, parent: tree, children: [] });

let found;
for (const each of [module]) found = each;
console.log(typeof found, tree.children[0].parent.name, tree.children[0].name, tree.children.length);
