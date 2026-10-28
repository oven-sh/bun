// The id filename loaded and path of a module object are stored to.
const path = require("path");
const base = v => typeof v === "string" ? path.basename(v) : v;
console.log(base(module.id), base(module.filename), module.loaded, base(module.path) !== "");
module.id = "changed id";
module.filename = "changed filename";
module.loaded = "changed loaded";
module.path = "changed path";
console.log(module.id, module.filename, module.loaded, module.path);
const a = require("./a.cjs");
console.log(a.before.map(base).join(), a.after().join());
