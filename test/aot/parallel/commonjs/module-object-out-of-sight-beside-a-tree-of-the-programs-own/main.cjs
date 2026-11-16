// A module object goes into a list, and nobody reads `children` or `parent` of it: the objects that are asked for members of these names are the program's own.
// An earlier compiler took the names for a guess that the files around the module object are asked for, learned from the engine that they are not, and compiled the program again without them:
// EngineRuns = 2, WholeEngineRuns = 1. A build runs the engine once now.
const { name } = require("./child.cjs");

const tree = { name: "root", parent: null, children: [] };
tree.children.push({ name, parent: tree, children: [] });

let found;
for (const each of [module]) found = each;
console.log(typeof found, tree.children[0].parent.name, tree.children[0].name, tree.children.length);
