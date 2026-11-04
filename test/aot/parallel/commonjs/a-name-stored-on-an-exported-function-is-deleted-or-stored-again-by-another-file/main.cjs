function pick(e) {
  return e && e.marker ? e : { default: e };
}

const before = pick(require("./exported.cjs"));
console.log(typeof before, before.default === before);
require("./changes.cjs");
const after = pick(require("./exported.cjs"));
console.log(typeof after, typeof after.default, after.default === before, before.marker, typeof before.default, before.default());
