// A function of one to four operations that returns a bare boolean, number or nothing, called by value: through an array, as a callback, as a method read from an object of unknown type, by call and apply, bound. The entry for such calls holds the body; what it returns and what it throws are as if it had been called.
const lines = [];
const isNumber = x => typeof x === "number";
const isString = x => typeof x === "string";
function isPositive(x) { return x > 0; }
function half(x) { return x / 2; }
function negated(x) { return -x; }
function lengthOf(x) { return x.length; }
function nothing(_x) {}
const isTagged = x => x.tag === "yes";
class Limit {
  count = 3;
  cache = { most: 5 };
  reached(other) { return other.count >= this.cache.most; }
  get double() { return this.count * 2; }
  bump() { this.count++; }
}
const values = [1, "a", 0, -1, 1.5, NaN, undefined, null, true, {}, [], 2 ** 40, "12"];
const table = [isNumber, isString, isPositive, half, negated, nothing];
for (const f of table) lines.push(f.name + ": " + values.map(v => String(f(v))).join(" "));
lines.push("as callbacks: " + values.filter(isNumber).join(",") + " | " + values.filter(isString).join(",") + " | " + [1, -2, 3].filter(isPositive).join(",") + " | " + [1, 2, 3].map(half).join(",") + " | " + [1, 2, 3].map(negated).join(",") + " | " + ["ab", [1, 2, 3]].map(lengthOf).join(",") + " | " + [1, 2].map(nothing).join(","));
lines.push("found: " + values.findIndex(isString) + " " + values.some(isNumber) + " " + values.every(isNumber) + " " + [{ tag: "no" }, { tag: "yes" }].findIndex(isTagged));
const limit = new Limit();
const anything = { reached: limit.reached, cache: { most: 1 }, bump: limit.bump, count: 10 };
for (let turn = 0; turn < 4; turn++) lines.push("methods: " + limit.reached({ count: turn * 2 }) + " " + anything.reached({ count: turn }) + " " + limit.double + " " + String(limit.bump()) + " " + String(anything.bump()) + " " + limit.count + " " + anything.count);
lines.push("call, apply, bind: " + isPositive.call(null, 3) + " " + half.apply(undefined, [5]) + " " + negated.bind(null, 41)() + " " + Reflect.apply(isNumber, undefined, ["x"]) + " " + limit.reached.call({ cache: { most: 0 } }, { count: 0 }));
lines.push("fewer and more arguments: " + table[0]() + " " + table[3]() + " " + table[4](1, 2, 3) + " " + String(table[5]()));
function throughTable(f, x) { return f(x); }
for (const [f, x] of [[lengthOf, null], [isTagged, undefined], [limit.reached, { count: 1 }], [isPositive, Symbol("no number")], [negated, { valueOf() { throw new RangeError("asked"); } }]]) {
  try { lines.push("no error: " + String(throughTable(f, x))); } catch (e) { lines.push(e.constructor.name + ": " + (e.message === "asked")); }
}
let sum = 0;
for (let i = 0; i < 3000; i++) { const f = table[i % table.length]; const got = f(i); sum += got === true ? 1 : typeof got === "number" ? got : 0; }
lines.push("sum " + sum);
console.log(lines.join("\n"));
