// reduce and reduceRight hold a number accumulator bare only where the compiler knows the callback; a callback that is some value gets the accumulator as it came back from the last call.
// IR= 0 sumsOf IsKnownFunction
// IR= 0 sumsOf  = Call 
// IR= 1 sumsWith IsKnownFunction
// SIZE< Array$reduce 800
// SIZE< Array$reduceRight 800
function sumsOf(lists) {
  let total = 0;
  for (let i = 0; i < lists.length; i++) total += lists[i].reduce((sum, x) => sum + x, 0);
  return total;
}
function sumsWith(lists, add) {
  let total = 0;
  for (let i = 0; i < lists.length; i++) total += lists[i].reduce(add, 0);
  return total;
}
function described(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "function") return "a function";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value);
}
function attempt(run) {
  try {
    return described(run());
  } catch (error) {
    return error.constructor.name;
  }
}
const kept = [sumsOf, sumsWith];
const lists = [[1, 2, 3], [], [4.5, 5.5], [6, , 7], ["a"], [2 ** 31, 1]];
console.log(described(kept[0]([[1, 2, 3], [], [4.5, 5.5], [6, , 7], [2 ** 31, 1]])));
console.log(described(kept[1]([[1, 2, 3], [], [4.5, 5.5], [6, , 7], [2 ** 31, 1]], (a, b) => a + b)));
console.log(described(kept[1]([[1, 2, 3]], Math.max)));

const seen = [];
const callbacks = {
  adds: (a, x) => a + x,
  multiplies: (a, x) => a * x,
  subtracts: (a, x) => a - x,
  negativeZero: (a, x) => -0,
  notANumber: (a, x) => NaN,
  infinite: (a, x) => a / 0,
  large: (a, x) => a + 2 ** 53,
  fraction: (a, x) => a + 0.1,
  wholeDouble: (a, x) => (a + 0.5) * 2,
  overflows: (a, x) => a + 2147483647,
  textAtTheSecond: (a, x, k) => (k === 1 ? "text" : a + x),
  undefinedAtTheSecond: (a, x, k) => (k === 1 ? undefined : a + x),
  objectThenNumber: (a, x, k) => (k === 0 ? { k } : 7),
  bigintAtTheEnd: (a, x, k, all) => (k === all.length - 1 ? 10n : a + 1),
  nothing: () => {},
  records: (a, x, k, all) => (seen.push(described(a) + "|" + described(x) + "|" + k + "|" + (all === current)), a + 1),
  counts: function () { return arguments.length; },
  sloppyThis: function (a) { return a + (this === globalThis ? 1 : 0); },
  strictThis: function (a) { "use strict"; return a + (this === undefined ? 1 : 0); },
  host: Math.max,
  hostTwo: Math.hypot,
  bound: function (step, a) { return a + step; }.bind(null, 3),
  proxy: new Proxy((a, x) => a + x, {}),
};
let current;
for (const name in callbacks) {
  for (const list of lists) {
    for (const initial of [0, 1.5, -0, NaN, 2147483647, "s", null, undefined, 5n, true]) {
      current = list;
      seen.length = 0;
      console.log(name, described(list), described(initial), attempt(() => list.reduce(callbacks[name], initial)), attempt(() => list.reduceRight(callbacks[name], initial)), seen.join(" "));
    }
    current = list;
    seen.length = 0;
    console.log(name, described(list), "no initial value", attempt(() => list.reduce(callbacks[name])), attempt(() => list.reduceRight(callbacks[name])), seen.join(" "));
  }
}

for (const notCallable of [undefined, null, 1, "text", {}, class C {}]) {
  console.log(attempt(() => [1, 2].reduce(notCallable, 0)), attempt(() => [].reduce(notCallable, 0)), attempt(() => [1, 2].reduceRight(notCallable, 0)));
}
console.log(attempt(() => [1, 2, 3].reduce((a, x) => { if (x === 2) throw new RangeError("two"); return a + x; }, 0)));

const shrinking = [1, 2, 3, 4];
console.log(described(shrinking.reduce((a, x, k, all) => { all.length = 2; return a + x; }, 0)));
const growing = [1, 2];
console.log(described(growing.reduce((a, x, k, all) => { all.push(9); return a + x; }, 0)), growing.length);
const turningToDoubles = [1, 2, 3];
console.log(described(turningToDoubles.reduce((a, x, k, all) => { all[k + 1] = 0.5; return a + x; }, 0)));
const turningToText = [1.5, 2.5, 3.5];
console.log(described(turningToText.reduce((a, x, k, all) => { all[2] = "z"; return a + x; }, 0)));
const holed = [1, 2, 3];
console.log(described(holed.reduce((a, x, k, all) => { delete all[1]; return a + x; }, 0)));
class Numbers extends Array {}
console.log(described(Numbers.from([1, 2, 3]).reduce(callbacks.adds, 0)), described(Array.prototype.reduce.call({ length: 2, 0: 4, 1: 5 }, callbacks.adds, 0)));
