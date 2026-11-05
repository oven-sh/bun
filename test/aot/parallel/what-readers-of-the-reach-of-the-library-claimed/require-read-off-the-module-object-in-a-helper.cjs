function loaderOf(m) { return m.require; }
console.log(typeof loaderOf(module).call(module, "node:os").platform());
