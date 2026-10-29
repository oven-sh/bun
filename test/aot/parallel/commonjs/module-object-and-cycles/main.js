// What a CommonJS body receives, what require() returns once module.exports is replaced, and require cycles.
// Entry points: ./cycle-a.js ./cycle-b.js ./function-exports.js ./module-object.js ./primitive-exports.js
globalThis.runs = { __proto__: null };
globalThis.countRun = name => (runs[name] = (runs[name] ?? 0) + 1);
globalThis.baseName = path => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

exports.marker = "set by main";
console.log("main:", this === exports, module.exports === exports, module.id, module.filename === __filename, __filename.startsWith(__dirname), require.main === module, typeof require.resolve);

const moduleObject = require("./module-object.js");
console.log("required:", JSON.stringify(moduleObject.atEntry));
console.log("same folder:", moduleObject.dirname === __dirname);

const double = require("./function-exports.js");
console.log("function:", typeof double, double.name, double(21), double.unit, double.discarded, require("./function-exports.js") === double);
console.log("primitive:", require("./primitive-exports.js"), require("./primitive-exports.js"), runs["primitive-exports"]);

const owner = moduleObject.self;
owner.exports = "replaced by main";
console.log("replaced after evaluation:", require("./module-object.js"));
owner.exports = undefined;
console.log("replaced by undefined:", require("./module-object.js"));
let reads = 0;
Object.defineProperty(owner, "exports", { configurable: true, get: () => "read " + ++reads });
console.log("accessor:", require("./module-object.js"), require("./module-object.js"));
Object.defineProperty(owner, "exports", { configurable: true, enumerable: true, writable: true, value: moduleObject });
console.log("restored:", require("./module-object.js") === moduleObject, runs["module-object"]);

const a = require("./cycle-a.js");
console.log("cycle:", a.b.partialAKeys, "|", a.b.partialBKeys, "|", a.b.readALate(), "|", Object.keys(a).join(), "|", a.listBKeys());
console.log("cycle ran once:", runs["cycle-a"], runs["cycle-b"], require("./cycle-a.js") === a, require("./cycle-b.js") === a.b);

const data = require("./data.json");
data.list.push(4);
console.log("json:", require("./data.json") === data, require("./data.json").list.length);

import("./module-object.js").then(namespace => {
  console.log("import after require:", namespace.default === moduleObject);
  console.log("runs:", JSON.stringify(runs));
});
