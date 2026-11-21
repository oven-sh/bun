// The extends clause of a class that a static field of an unused class holds stores a literal as a prototype in a function, and nothing makes the function. The build does not name it.
const base = {
  size() {
    return this.v + 1;
  },
};
export const holds = value => base.isPrototypeOf(value);
class Unused {
  static Inside = class extends /* @__PURE__ */ (function () {
  var Inner = function (v) {
    this.v = v;
  };
  Inner.prototype = base;
  if (!Inner) Inner = null;
  return Inner;
})() {};
}
console.log(holds({}));
