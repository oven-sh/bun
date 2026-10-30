// Every kind of write to createRequire and Module of node:module.
const M = require("node:module");
const mine = () => name => console.log("mine", name);
const key = name => name.slice(0, 3) + name.slice(3);
const { createRequire, Module } = M;
function attempt(change) {
  try {
    console.log(String(change()));
  } catch (error) {
    console.log(String(error).split(" (bun compile")[0]);
  }
}

attempt(() => {
  M.createRequire = mine;
});
attempt(() => {
  M[key("createRequire")] = mine;
});
attempt(() => {
  Object.defineProperty(M, "createRequire", { value: mine });
});
attempt(() => {
  Object.defineProperties(M, { createRequire: { get: mine } });
});
attempt(() => {
  Object.assign(M, { createRequire: mine });
});
attempt(() => {
  [M.createRequire] = [mine];
});
attempt(() => {
  M.createRequire &&= mine;
});
attempt(() => {
  for (M.createRequire of [mine]);
});
attempt(() => delete M.createRequire);
attempt(() => Reflect.set(M, "createRequire", mine));
attempt(() => Reflect.defineProperty(M, "createRequire", { value: mine }));
attempt(() => Reflect.deleteProperty(M, "createRequire"));
attempt(() => Reflect.set(new Proxy(M, {}), "createRequire", mine));
attempt(() => Reflect.deleteProperty(new Proxy(M, {}), "createRequire"));
attempt(() => {
  M.createRequire ||= mine;
});
attempt(() => {
  Object.defineProperty(M, "createRequire", { value: M.createRequire });
});

attempt(() => {
  M.Module = mine;
});
attempt(() => {
  M[key("Module")] = mine;
});
attempt(() => {
  Object.defineProperty(M, "Module", { value: mine });
});
attempt(() => {
  Object.defineProperties(M, { Module: { get: mine } });
});
attempt(() => {
  Object.assign(M, { Module: mine });
});
attempt(() => {
  [M.Module] = [mine];
});
attempt(() => {
  M.Module &&= mine;
});
attempt(() => {
  for (M.Module of [mine]);
});
attempt(() => delete M.Module);
attempt(() => Reflect.set(M, "Module", mine));
attempt(() => Reflect.defineProperty(M, "Module", { value: mine }));
attempt(() => Reflect.deleteProperty(M, "Module"));
attempt(() => Reflect.set(new Proxy(M, {}), "Module", mine));
attempt(() => Reflect.deleteProperty(new Proxy(M, {}), "Module"));
attempt(() => {
  M.Module ||= mine;
});
attempt(() => {
  Object.defineProperty(M, "Module", { value: M.Module });
});

M.mine = 1;
console.log(M.mine, M.createRequire === createRequire, M.Module === Module);
process.getBuiltinModule("node:module").createRequire(__filename)("./next.cjs");
/* Output:
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.createRequire because built-in objects are read-only in a compiled executable
TypeError: Cannot delete node:module.createRequire because built-in objects are read-only in a compiled executable
false
false
false
false
false
undefined
undefined
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot assign to node:module.Module because built-in objects are read-only in a compiled executable
TypeError: Cannot delete node:module.Module because built-in objects are read-only in a compiled executable
false
false
false
false
false
undefined
undefined
1 true true
the next file
*/
