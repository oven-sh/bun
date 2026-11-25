// An unused class keeps the check of its extends clause and the conversion of its key, and both run functions that store a prototype.
const base = {
  size() {
    return this.v + 1;
  },
};
export const holds = value => base.isPrototypeOf(value);
let ran = 0;
class UnusedHeir extends (function () {
  var Inner = function (v) {
    this.v = v;
  };
  Inner.prototype = base;
  ran++;
  return Inner;
})() {}
class UnusedKeyed {
  [(function () {
    var Inner = function (v) {
      this.v = v;
    };
    Inner.prototype = base;
    ran++;
    return String(Inner.name);
  })()]() {}
}
console.log(holds({}), ran);
