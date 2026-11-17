// list.includes(x) and list.indexOf(x) outside loops, of values and lists of which nothing is known: integers, fractions, -0, NaN, texts, ropes, symbols, big integers, holes, lists of every kind, short and long.
// STATISTIC: UnknownValuesSearchedByStub >= 4
class Finder {
  constructor(list) { this.list = list; }
  has(value) { return this.list.includes(value); }
  at(value) { return this.list.indexOf(value); }
}
function includes(list, value) { return list.includes(value); }
function indexOf(list, value) { return list.indexOf(value); }
function isAbsent(list, value) { if (list.indexOf(value) < 0) return "-"; return list.includes(value) ? "+" : "?"; }
const symbol = Symbol("s"), object = { valueOf() { return 1; } }, closure = () => 1;
const long = length => Array.from({ length }, (_, i) => i * 3);
const rope = part => "a".repeat(part) + part;
const grown = []; for (let i = 0; i < 5; i++) grown.push(i);
const widened = [1, 2, 3]; widened.push(0.5); const mixed = [1, 2, 3]; mixed.push("1"); const shrunk = long(20); shrunk.length = 3; const holes = [1, 2, 3]; delete holes[1]; const doubleHoles = [0.5, 1.5, 2.5]; delete doubleHoles[0];
const lists = [[], [1, 2, 3, 2147483647, -1, -2147483648], [0.5, 1, 2, -0, 3.25], [NaN, 1.5, Infinity], [0, -0, 5], [1, , 3, , 5], [0.5, , 1], ["a", 1, "b", 2.5, null, undefined, true], [symbol, object, 1n, 2n, "1", 1, closure], long(8), long(16), long(17), long(40), long(400), long(400).map(x => x / 2), long(16).map(x => x / 2), long(17).map(String), long(400).map(x => ({ x })).concat([object]), Object.freeze([1, 2, 3]), new Array(9), new Array(3).fill(0.5), Object.assign([1, 2, 3], { 7: 1 }), new (class extends Array {})(1, 2, 3), new Int32Array([1, 2, 3]), new Float64Array([1, 0.5, NaN, -0]), "a1b2", grown, widened, mixed, shrunk, holes, doubleHoles, [undefined, null, false], [rope(3), rope(4), "aaa3"], JSON.parse("[1,2,1.5,\"x\",null]"), Array.from("abc"), [4, 5, 6].concat([7])];
const values = [1, 2, 3, 0, -0, 0.5, 1.5, NaN, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 1e300, 5e-324, Infinity, -Infinity, "a", "1", "", "48", rope(3), rope(4), null, undefined, true, false, symbol, object, closure, {}, 1n, 2n, 0n, 3, 9, 45, 48, 117, 1197, 1200, 598.5, 24, 23.5];
const integers = [1, 2, 3, 2147483647, -1, 0], doubles = [0.5, 1, 2, -0, 3.25], kinds = ["a", 1, "b", 2.5, null, undefined, true, symbol, object, 1n, closure], gaps = [1, , 3], few = [null], none = [], wide = long(300), halves = wide.map(x => x / 2);
const known = [v => integers.includes(v), v => integers.indexOf(v), v => doubles.includes(v), v => doubles.indexOf(v), v => kinds.includes(v), v => kinds.indexOf(v), v => gaps.includes(v), v => gaps.indexOf(v), v => few.includes(v), v => none.indexOf(v), v => Array.isArray(wide) && wide.includes(v), v => halves.indexOf(v), v => [v, 1].indexOf(v), v => [1, 0.5, "48"].includes(v)];
let digest = 0, cases = 0;
function note(line) { cases++; for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0; if (cases % 13 === 7) console.log(cases, line.slice(0, 120)); }
for (const list of lists) {
  const finder = new Finder(list);
  let line = "";
  values.forEach(value => {
    try { line += `${includes(list, value)},${indexOf(list, value)},${finder.has(value)},${finder.at(value)},${isAbsent(list, value)};`; } catch (error) { line += error.constructor.name; }
  });
  note(line);
  const callbacks = values.map(value => { try { return list.includes(value) ? list.indexOf(value) : -3; } catch (error) { return error.constructor.name; } });
  note(callbacks.join());
}
for (const search of known) note(values.map(value => search(value)).join());
for (const receiver of [null, undefined, {}, { includes: () => 7, indexOf: () => 8 }, 5, { length: 2, 0: "a", includes: Array.prototype.includes, indexOf: Array.prototype.indexOf }]) {
  let line = "";
  for (const value of ["a", 1, undefined]) { try { line += includes(receiver, value) + "," + indexOf(receiver, value) + ";"; } catch (error) { line += error.constructor.name; } }
  note(line);
}
console.log(cases, digest);
