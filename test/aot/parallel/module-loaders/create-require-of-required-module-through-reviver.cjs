// createRequire is taken off require("module") and comes back out of a native call, so its call site has an unknown callee.
const { createRequire } = require("module");
const holder = { load: createRequire };
const view = JSON.parse('{"a":1}', function (key, value) {
  return key === "" ? holder : value;
});
console.log(typeof view.load(__filename)(process.argv[2] ?? "node:net").Socket);
const other = { load: require("node:module").createRequire };
const second = JSON.parse("[1]", (key, value) => (key === "" ? other : value));
console.log(typeof second.load(__filename)(process.argv[3] ?? "node:path").join);
