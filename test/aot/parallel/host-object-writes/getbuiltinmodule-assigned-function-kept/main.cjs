// Get builtin module is assigned a function that is kept and hands on to the one before.
const holder = {};
const own = process.getBuiltinModule;
holder.kept = process.getBuiltinModule = function (id) {
  console.log("asked for", id);
  return own.apply(this, arguments);
};
console.log(typeof process.getBuiltinModule("node:path").sep, typeof process.getBuiltinModule(["node", "os"].join(":")).EOL);
console.log(holder.kept === process.getBuiltinModule, process.getBuiltinModule === own);
process.getBuiltinModule("node:module").createRequire(__filename)("./next.cjs");
const load = process.getBuiltinModule("module").createRequire(__filename);
load("./next.cjs");
process.getBuiltinModule = own;
console.log(typeof process.getBuiltinModule("node:path").sep, process.getBuiltinModule === own);
