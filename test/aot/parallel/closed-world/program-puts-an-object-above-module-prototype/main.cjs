// The program puts an object with a getter between Module.prototype and Object.prototype. A file reads that name on its module object.
// Todo: the table of built-ins does not say that Module.prototype stands above a module object, so the build does not see that the getter runs for `module.hot`. The executable throws `inner.secret is not a function`.
const inner = require("./inner.cjs");
const caught = [];
const between = Object.create(Object.prototype, {
  hot: {
    configurable: true,
    get() {
      caught.push(this);
      return undefined;
    },
  },
});
Object.setPrototypeOf(require("node:module").prototype, between);
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
