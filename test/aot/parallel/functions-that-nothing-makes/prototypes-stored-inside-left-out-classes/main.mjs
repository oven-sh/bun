// An unused function stores a literal as a prototype inside a class, a parameter or a left-out module, and the build does not name it.
const inHeritage = {
  size() {
    return this.v + 1;
  },
};
const inField = {
  size() {
    return this.v + 2;
  },
};
const inParameter = {
  size() {
    return this.v + 3;
  },
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_used = __commonJS((exports, module) => {
  exports.holds = value => [inHeritage, inField, inParameter].map(it => it.isPrototypeOf(value));
});
var require_unused = __commonJS((exports, module) => {
  class Holder extends (() => {
    var Inner = function (v) {
      this.v = v;
    };
    Inner.prototype = inHeritage;
    if (!Inner) Inner = null;
    return Inner;
  })() {}
});
class UnusedHolder {
  made = (function () {
    var Inner = function (v) {
      this.v = v;
    };
    Inner.prototype = inField;
    if (!Inner) Inner = null;
    return Inner;
  })();
}
const unusedTaker = /*#__PURE__*/ (function () {
  return function take(
    made = (function () {
      var Inner = function (v) {
        this.v = v;
      };
      Inner.prototype = inParameter;
      if (!Inner) Inner = null;
      return Inner;
    })(),
  ) {
    return made;
  };
})();
console.log(require_used().holds({}).join());
