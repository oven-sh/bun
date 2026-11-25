// The default of an unused pattern stores a literal as a prototype in a function, and nothing makes the function. The build does not name it.
const base = {
  size() {
    return this.v + 1;
  },
};
export const holds = value => base.isPrototypeOf(value);
const [unused = /* @__PURE__ */ (function () {
  var Inner = function (v) {
    this.v = v;
  };
  Inner.prototype = base;
  if (!Inner) Inner = null;
  return Inner;
})()] = [];
console.log(holds({}));
