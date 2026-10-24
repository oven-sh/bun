// What `module.children` lists where a file requires a JSON file, an ES module and a CommonJS file, under constant names and under computed ones.
// `bun run` lists the JSON file that is required under a constant name too: "data.json,a.cjs". An executable has no module object for it. The expected output is written down.
const nameOf = child => child.filename.slice(Math.max(child.filename.lastIndexOf("/"), child.filename.lastIndexOf("\\")) + 1);
require("./data.json");
require("./es.mjs");
require("./a.cjs");
console.log(module.children.map(nameOf).join());
const computed = name => ["./", name].join("");
require(computed("more.json"));
require(computed("b.cjs"));
console.log(module.children.map(nameOf).join());
