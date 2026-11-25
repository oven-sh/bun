"use strict";
class Leaf { constructor(rows) { this.rows = rows; } }
class Branch { constructor(leaf) { this.leaf = leaf; } }
class Tree { constructor(branch) { this.branch = branch; } }
function sum(tree, start) { let total = start; for (let place = 0; place < tree.branch.leaf.rows.length; place++) total = total + tree.branch.leaf.rows[place]; return total; }
const tree = new Tree(new Branch(new Leaf(JSON.parse(process.argv[2] ?? "[1,2,3.5]"))));
console.log("SAID", sum(tree, 0));
tree.branch.leaf = new Leaf([4, 5]);
console.log("SAID", sum(tree, 0));
tree.branch = new Branch(new Leaf([6]));
console.log("SAID", sum(tree, 0));
