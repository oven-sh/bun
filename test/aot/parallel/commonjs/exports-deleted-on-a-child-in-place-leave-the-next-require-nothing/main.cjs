// The child is never held in a name and goes into no call: `exports` is deleted on it where it is read.
console.log(require("./lib.cjs").a, require("./user.cjs").seen());
console.log(delete module.children[0].exports);
console.log(require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
module.children[0].exports = { a: "stored" };
console.log(require("./lib.cjs")?.a, require("./" + JSON.parse('"lib.cjs"'))?.a, require("./user.cjs").seen());
