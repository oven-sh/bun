// The helper reads the members of its table, so a getter there runs ahead of the statements below.
import { c, x } from "./runtime.mjs";
var names = {};
x(names, {
  get a() {
    try {
      console.log(lazy());
    } catch (error) {
      console.log(error.name);
    }
    return () => 1;
  },
});
var require_a = c(function (exports) {
  exports.a = "ran";
});
function lazy() {
  return require_a().a;
}
console.log(lazy(), names.a);
