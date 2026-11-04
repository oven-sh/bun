// A file whose run threw runs again at the next require(), with a module object of its own, whose parent is the file that required it for that run.
for (let i = 0; i < 2; i++) { try { require("./t.cjs"); } catch {} }
try { require("./other.cjs"); } catch {}
globalThis.succeed = true;
require("./t.cjs");
console.log(globalThis.parents.map(p => p && require("node:path").basename(p.filename)).join(), module.children.map(c => require("node:path").basename(c.filename)).join());
