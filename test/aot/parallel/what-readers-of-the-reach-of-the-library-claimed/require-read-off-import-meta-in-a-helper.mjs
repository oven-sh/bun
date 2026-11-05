const pick = (meta) => meta.require;
console.log(typeof pick(import.meta)("node:os").platform());
