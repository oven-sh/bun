class BelowArray extends Array {}
class Over extends (function (a) {}) {
  #mark = 2;
  static isMarked(o) { return #mark in o; }
}
const o = Reflect.construct(Over, [1], BelowArray);
console.log(Over.isMarked(o), o instanceof BelowArray, Array.isArray(o));
