var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_inner = __commonJS((exports, module) => {
  module.exports = 7;
});
var require_outer = __commonJS((exports, module) => {
  module.exports = require_inner() + 1;
});
export var outer = require_outer();
console.log("body: in a second inner module");
Promise.resolve().then(() => console.log("job: in a second inner module"));
