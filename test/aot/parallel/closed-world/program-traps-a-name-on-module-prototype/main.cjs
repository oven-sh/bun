// The program itself defines a getter on Module.prototype. A file reads that name on its module object, and the getter stores into what the file exports.
// Todo: the table of built-ins does not say that Module.prototype stands above a module object, so the build does not see that the getter runs for `module.hot`. The executable throws `inner.secret is not a function`.
const inner = require("./inner.cjs");
const caught = [];
Object.defineProperty(require("node:module").prototype, "hot", {
  configurable: true,
  get() {
    caught.push(this);
    return undefined;
  },
});
const state = inner.isHot();
let replaced = false;
for (const m of caught) {
  if (typeof m.exports.secret === "function") {
    m.exports.secret = function replacement() {
      return "replaced";
    };
    replaced = true;
  }
}
console.log(JSON.stringify({ state, caught: caught.length, replaced, secret: inner.secret() }));
