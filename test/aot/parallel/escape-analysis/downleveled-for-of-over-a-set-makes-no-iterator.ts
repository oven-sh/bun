// for-of over a Set as TypeScript writes it for ES5: neither the iterator nor a result of a step is made.
// COUNT: allCells <= 5000
var __values = function (o: any): any {
  var s = typeof Symbol === "function" && Symbol.iterator,
    m = s && o[s],
    i = 0;
  if (m) return m.call(o);
  if (o && typeof o.length === "number")
    return {
      next: function () {
        if (o && i >= o.length) o = void 0;
        return { value: o && o[i++], done: !o };
      },
    };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
const numbers: Set<number> = new Set([1, 2, 3, 4]);
function sum(i: number): number {
  var e_1: any, _a: any;
  var s = i & 1;
  try {
    for (var xs_1 = __values(numbers), xs_1_1 = xs_1.next(); !xs_1_1.done; xs_1_1 = xs_1.next()) {
      var x = xs_1_1.value;
      s += x;
    }
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (xs_1_1 && !xs_1_1.done && (_a = xs_1.return)) _a.call(xs_1);
    } finally {
      if (e_1) throw e_1.error;
    }
  }
  return s;
}
let total = 0;
for (let i = 0; i < 20000; i++) total = (total + sum(i)) | 0;
console.log(total);
