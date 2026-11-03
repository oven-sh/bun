// The program puts an object with a getter between Module.prototype and Object.prototype. A file reads that name on its module object.
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
