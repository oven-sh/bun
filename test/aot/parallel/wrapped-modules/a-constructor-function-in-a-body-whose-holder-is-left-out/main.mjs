// A constructor function in a wrapped module keeps its layout where the variable that held the wrapper is left out.
// STATISTIC: ConstructorFieldsFoldedIntoAllocations >= 3
import { tree } from "./bundle.mjs";

let node = null;
for (let tag = 0; tag < 5; tag++) node = tree.make(tag, node);
console.log(tree.mark(node, 3), tree.mark(globalThis.lastSeen.parent, 4).lanes, node.lanes);
console.log(tree.mark({ lanes: 8, parent: null }, 1), Object.keys(node), node.constructor.name);
