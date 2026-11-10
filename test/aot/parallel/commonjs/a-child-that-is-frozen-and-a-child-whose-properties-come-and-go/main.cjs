// Object.freeze() fixes `exports` on the module object of another file, with the value that it shows. Properties that come and go on a module object change nothing,
// and a delete of `exports` behind them is seen, and so is a store behind the delete.
const lib = require("./lib.cjs");
const other = require("./other.cjs");
const [child, second] = module.children;
Object.freeze(child);
console.log(JSON.stringify(require("./lib.cjs")), Object.isFrozen(child));
console.log(JSON.stringify(require("./lib.cjs")), JSON.stringify(child.exports));
for (let i = 0; i < 200; i++) second["more" + i] = i;
for (let i = 0; i < 200; i += 2) delete second["more" + i];
console.log(JSON.stringify(require("./other.cjs")));
console.log(delete second.exports, JSON.stringify(require("./other.cjs")));
second.exports = { a: "stored" };
console.log(JSON.stringify(require("./other.cjs")));
