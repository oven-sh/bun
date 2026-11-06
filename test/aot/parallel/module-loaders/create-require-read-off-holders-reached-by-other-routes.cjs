// createRequire is read by name off a holder that the program reaches by several routes. It comes back out of a native call, so its call site has an unknown callee.
function throughReviver(load) {
  const holder = { load };
  return JSON.parse("[1]", (key, value) => (key === "" ? holder : value));
}
const M = require("module");
const {
  Module: { createRequire },
} = M;
const routes = [
  require("module").Module.createRequire,
  process.getBuiltinModule("module").createRequire,
  createRequire,
  [M][0].createRequire,
];
for (const route of routes) {
  console.log(typeof throughReviver(route).load(__filename)(process.argv[2] ?? "node:net").Socket);
}
