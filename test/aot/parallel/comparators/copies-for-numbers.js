// lodash's compareAscending: two numbers are compared by the copy at the call.
// STATISTIC: ComparatorsInlinedForNumbers >= 1
let asked = 0;
function isSymbol(value) {
  return typeof value == "symbol" || (value != null && typeof value == "object" && ++asked > 0 && Object.prototype.toString.call(value) == "[object Symbol]");
}
function compareAscending(value, other) {
  if (value !== other) {
    var valIsDefined = value !== undefined, valIsNull = value === null, valIsReflexive = value === value, valIsSymbol = isSymbol(value);
    var othIsDefined = other !== undefined, othIsNull = other === null, othIsReflexive = other === other, othIsSymbol = isSymbol(other);
    if ((!othIsNull && !othIsSymbol && !valIsSymbol && value > other) || (valIsSymbol && othIsDefined && othIsReflexive && !othIsNull && !othIsSymbol) || (valIsNull && othIsDefined && othIsReflexive) || (!valIsDefined && othIsReflexive) || !valIsReflexive) return 1;
    if ((!valIsNull && !valIsSymbol && !othIsSymbol && value < other) || (othIsSymbol && valIsDefined && valIsReflexive && !valIsNull && !valIsSymbol) || (othIsNull && valIsDefined && valIsReflexive) || (!othIsDefined && valIsReflexive) || !othIsReflexive) return -1;
  }
  return 0;
}
function compareMultiple(object, other, orders) {
  var index = -1, length = object.criteria.length;
  while (++index < length) {
    var result = compareAscending(object.criteria[index], other.criteria[index]);
    if (result) {
      if (index >= orders.length) return result;
      return result * (orders[index] == "desc" ? -1 : 1);
    }
  }
  return object.index - other.index;
}
function sortBy(list, criteria, orders) {
  return list.map((value, index) => ({ criteria: criteria.map(name => value[name]), index, value })).sort((a, b) => compareMultiple(a, b, orders)).map(entry => entry.value);
}
const show = value => (typeof value == "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : typeof value + String(value));
const values = [3, -0, 0, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53, "10", "9", "a", "", null, undefined, true, 10n, Symbol.iterator, { valueOf: () => 2 }, [4], new Date(5)];
const items = Array.from({ length: 60 }, (_, k) => ({ a: ((k * 37) % 91) + 0.5, b: "s" + (k % 17), c: k % 4, d: values[k % values.length] }));
console.log(sortBy(items, ["a"], []).map(x => x.a).join());
console.log(sortBy(items, ["c", "a"], ["desc"]).map(x => x.c + ":" + x.a).join());
console.log(sortBy(items, ["c", "b"], ["asc", "desc"]).map(x => x.c + x.b).join());
const lines = [];
for (const x of values) {
  let line = "";
  for (const y of values) {
    try {
      line += compareMultiple({ criteria: [x, x], index: 1 }, { criteria: [y, x], index: 2 }, [, "desc"]) + " ";
    } catch (error) {
      line += error.constructor.name + " ";
    }
  }
  lines.push(show(x) + " " + line);
}
console.log(lines.join("\n"), asked);
const plain = values.filter(x => typeof x != "bigint" && typeof x != "symbol");
console.log(sortBy(plain.map(d => ({ d })), ["d"], []).map(x => show(x.d)).join());
// d3's ascending, called by functions that loops call.
function ascending(a, b) {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}
function rank(list, x) {
  let lower = 0;
  for (let k = 0; k < list.length; k++) if (ascending(list[k], x) < 0) lower++;
  return lower;
}
console.log(plain.map(x => rank(plain, x)).join(), rank([5, 3, 2.5, NaN, 4], 4), rank(["b", "a"], "b"));
