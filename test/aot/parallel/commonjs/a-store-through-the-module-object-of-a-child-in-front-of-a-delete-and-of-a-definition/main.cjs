// `child.exports = x` is a store through the module object of another file. A delete behind it leaves nothing, on the object and for whoever requires the file; a value defined behind it is what both see.
require("./lib.cjs");
require("./other.cjs");
const [child, second] = module.children;
require("./lib.cjs");
require("./other.cjs");
child.exports = { name: "second" };
console.log(require("./lib.cjs").name, delete child.exports, require("./lib.cjs"), child.exports, "exports" in child);
second.exports = { name: "second" };
Object.defineProperty(second, "exports", { value: { name: "third" }, writable: true, enumerable: false });
console.log(require("./other.cjs").name, second.exports.name, Object.keys(second).includes("exports"));
