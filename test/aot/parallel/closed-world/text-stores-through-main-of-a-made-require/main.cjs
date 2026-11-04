// Text is handed a require that createRequire() made. By its `main` it holds the module object of the entry point, and among the children of that the object of inner.cjs.
// What the text stores through the two is what the program reads from then on.
const { createRequire } = require("node:module");
const inner = require("./inner.cjs");
globalThis.made = createRequire(__filename);
globalThis.report = (road, found) => console.log("the text, " + road + ":", found);
const run = text => new Function(Buffer.from(text).toString())();
const nameOf = path => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
run(`
  const main = made.main;
  const child = main.children.find(child => child.filename.endsWith("inner.cjs"));
  report("process.mainModule is its main", process.mainModule === main);
  child.exports.count = () => "replaced";
  main.exports = { swapped: true };
  main.id = "renamed";
  main.filename = main.filename.slice(0, -"main.cjs".length) + "renamed.cjs";
`);
console.log("the program goes on:", inner.count(1), module.exports.swapped, module.id, nameOf(module.filename), require("./inner.cjs").count(2));
run(`made.main.children.find(child => child.filename.endsWith("inner.cjs")).exports = { count: () => "another object" };`);
console.log("behind another object:", inner.count(3), require("./inner.cjs").count(4));
