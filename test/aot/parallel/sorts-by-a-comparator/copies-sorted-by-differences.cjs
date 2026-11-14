// list.toSorted() by a difference of its two parameters, either way round: numbers of every kind of storage, short lists and long ones, and lists that hold anything else.
// STATISTIC: SortComparatorCallsElided >= 2
const told = list => list.map(x => (Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "object" && x ? "o" + x.at : String(x))).join(" ");
const spell = list => (list.length > 24 ? list.length + ": " + told(list.slice(0, 8)) + " .. " + told(list.slice(-8)) + " sum " + list.reduce((a, x, k) => (a * 31 + (typeof x === "number" ? x * 4 : 7) + k) | 0, 0) : told(list));
function up(list) { return list.toSorted((x, y) => x - y); }
function down(list) { return list.toSorted((x, y) => y - x); }
function answer(f) { try { return f(); } catch (e) { return e.name + " " + e.message.slice(0, 60); } }
const numbers = (n, f) => { const list = []; for (let i = 0; i < n; i++) list.push(f((i * 7919) % 1009, i)); return list; };
const at = k => ({ at: k, valueOf() { return k; } });
class Rows extends Array {}
const holed = numbers(20, x => x); delete holed[3]; delete holed[11];
const longHoled = numbers(120, x => x * 0.5); delete longHoled[50];
const spare = []; spare[40] = 5; spare[2] = 9; spare[7] = 1;
const lists = [[], [1], [2, 1], [1, 2], [0.5, 0.25], numbers(7, x => x), numbers(64, x => x), numbers(65, x => x), numbers(300, x => x - 500), numbers(3000, x => x * x * x * 900), numbers(40, x => x * 0.5), numbers(300, x => x * 0.1 - 40),
  numbers(90, (x, i) => (i & 1 ? x : x + 0.5)), numbers(90, (x, i) => (i === 60 ? NaN : x)), numbers(9, (x, i) => (i === 4 ? NaN : x)), numbers(12, (x, i) => (i % 3 ? 0 : -0)), numbers(100, (x, i) => (i % 3 ? x & 1 : -0)), numbers(30, (x, i) => (i % 5 ? x : Infinity * (i & 1 ? 1 : -1))),
  holed, longHoled, spare, [undefined, 3, undefined, 1, 2], [undefined, undefined], [3, "20", 1, "x", 2], ["b", "a"], [at(3), at(1), at(2)], numbers(80, x => at(x % 17)), [3n, 1n, 2n], numbers(70, x => BigInt(x)), [true, false, 2, null], [null, 1, -1],
  Rows.from(numbers(70, x => x)), Object.freeze(numbers(70, x => x)), Object.seal(numbers(9, x => x * 0.5)), numbers(70, (x, i) => (i === 69 ? "7" : x))];
for (let round = 0; round < 2; round++) {
  for (const list of lists) {
    const before = spell(list);
    const a = answer(() => up(list)), b = answer(() => down(list));
    console.log(typeof a === "string" ? a : spell(a), "|", typeof b === "string" ? b : spell(b), "|", before === spell(list), a !== list, Array.isArray(a) && a.constructor === Array, Array.isArray(a) && Object.keys(a).length);
  }
}
// What comes back belongs to who asked, and may be changed like any list.
const first = numbers(100, x => x), second = up(first); second.push(-1); second[0] = "text"; second.length = 5; console.log(spell(second), spell(first));
const third = down(numbers(80, x => x * 0.5)); third[0] = 1; third[1] = undefined; third[200] = 4; console.log(third.length, 100 in third, spell(third.slice(0, 5)));
let sum = 0; for (let i = 0; i < 400; i++) { const t = down([i % 7, i % 5, i % 3]); sum = (sum * 31 + t[0] * 9 + t[1] * 3 + t[2]) | 0; } console.log(sum);
let grown = []; for (let i = 0; i < 200; i++) { grown = up([...grown, (i * 7919) % 211]); } console.log(spell(grown));
// What is no list, and what has another toSorted().
console.log(answer(() => spell(up({ toSorted: f => [f(5, 3)] }))), answer(() => spell(Array.prototype.toSorted.call({ length: 3, 0: 3, 2: 1 }, (x, y) => x - y))), answer(() => spell([...up(new Float64Array([3, 1, 2]))])), answer(() => up(null)), answer(() => up("abc")));
const own = numbers(70, x => x); own.toSorted = () => ["own"]; console.log(spell(up(own)));
console.log(spell(up(new Proxy(numbers(70, x => x), { get(t, k) { return Reflect.get(t, k); } }))));
// The comparator is asked where a value is no number, with the values that plain Bun asks it with.
const seen = []; const asked = numbers(12, (x, i) => (i === 5 ? { at: i, valueOf() { seen.push("v"); return x; } } : x)); console.log(spell(up(asked)), seen.length);
const above = Object.create(Array.prototype); above[3] = 77; above[0] = 5; const inherits = Object.setPrototypeOf([8, , 2, , 4], above), dense = Object.setPrototypeOf(numbers(70, x => x), above); console.log(spell(up(inherits)), "|", spell(down(inherits)), "|", spell(up(dense)), Object.getPrototypeOf(up(dense)) === Array.prototype);
