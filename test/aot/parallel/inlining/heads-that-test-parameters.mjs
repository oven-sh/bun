// The first lines of a comparator that test its parameters are copied into loops; the rest is called.
let calls = 0;
function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  calls++;
  const left = typeof a, right = typeof b;
  if (left !== right) return left < right ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : a === b ? 0 : Number.isNaN(a) ? (Number.isNaN(b) ? 0 : -1) : 1;
}
function add(a, b) { if (typeof a === "number" && typeof b === "number") return a + b; calls++; if (a === null || b === undefined) throw new TypeError("nothing"); return String(a) + "+" + String(b); }
function indexOf(list, wanted, order) { let low = 0, high = list.length; while (low < high) { const middle = (low + high) >> 1; const answer = order(list[middle], wanted); if (answer < 0) low = middle + 1; else if (answer > 0) high = middle; else return middle; } return ~low; }
function smallest(list) { let found = list[0]; for (let i = 1; i < list.length; i++) if (compare(list[i], found) < 0) found = list[i]; return found; }
function sums(list, other) { const out = []; for (let i = 0; i < list.length; i++) { try { out.push(add(list[i], other[i])); } catch (error) { out.push(error.message); } } return out.map(String).join(); }
const lists = [[1, 2, 5, 9, 12], [1.5, 2.5, NaN, 7], ["a", "b", "d"], [1, 2, "b", "c"], [-0, 0], [true, false, 3], [2147483647, -2147483648, 4e15], [null, undefined, {}, 1n]];
for (const list of lists) {
  for (const wanted of [2, 2.5, "b", NaN, true, undefined]) console.log(indexOf(list, wanted, compare), indexOf(list, wanted, (a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  console.log(String(smallest(list)), sums(list, lists[0]), sums(lists[1], list), Object.is(add(-0, -0), -0), Object.is(compare(0, 0), 0), calls);
}
