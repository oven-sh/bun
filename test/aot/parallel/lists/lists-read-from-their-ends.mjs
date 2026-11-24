// reduceRight() and `k in list` in loops that count down: lists of each kind, holes, elements above, getters, lists that the callback changes, indexes outside.
const lines = [];
const say = (...values) => lines.push(values.map(value => typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)).join(" "));
let calls = 0;
const makers = {
  ints: () => [3, 1, 2], doubles: () => [0.5, NaN, 2], texts: () => ["a", "b"], mixed: () => [1, "x", null, undefined, 2.5], holes: () => [1, , 3, ,], empty: () => [], one: () => [7], sparse: () => { const list = [1]; list[9] = 2; list[40000] = 3; list.length = 12; return list; },
  getter: () => Object.defineProperty([1, 2, 3], 1, { get() { calls++; return "got"; }, configurable: true, enumerable: true }), frozen: () => Object.freeze([4, 5]), sub: () => new (class Sub extends Array {})(6, 7, 8), above: () => { const list = [1, , 3]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: "above", configurable: true } })); return list; },
  like: () => ({ length: 3, 0: "a", 2: "c" }), view: () => new Uint8Array([1, 2]), text: () => "xyz", negative: () => ({ length: -1 }), fraction: () => ({ length: 2.7, 0: 1, 1: 2 }),
};
const add = (a, b) => String(a) + "|" + String(b);
for (let turn = 0; turn < 3; turn++) {
  for (const [name, make] of Object.entries(makers)) {
    const list = make();
    try { say(name, Array.prototype.reduceRight.call(list, add, "s")); } catch (error) { say(name, error.constructor.name); }
    try { say(name, Array.prototype.reduceRight.call(list, add)); } catch (error) { say(name, error.constructor.name, error.message); }
    try { say(name, Array.prototype.reduceRight.call(list, (a, b, k, all) => a + k + (all === list), "")); } catch (error) { say(name, error.constructor.name); }
  }
}
function known(turns) { let r = 0; const list = [1, 2, 3, 4]; for (let j = 0; j < turns; j++) { r += list.reduceRight((s, x) => s + x, j); r += list.reduceRight((s, x) => s * 2 + x); if (j === 3) list[1] = 0.5; if (j === 5) list.push(9); if (j === 7) list.length = 2; if (j === 9) delete list[0]; if (j === 11) list[0] = "t"; } return r; }
say(known(14));
function has(list, from, to) { let t = ""; for (let k = from; k >= to; k--) t += k in list ? list[k] : "-"; return t; }
for (const [name, make] of Object.entries(makers)) { try { say(name, has(make(), 5, -2)); } catch (error) { say(name, error.constructor.name); } }
function typed(list) { let n = 0; for (let k = list.length - 1; k >= 0; k--) { if (k in list) n += list[k]; else n += 100; } return n; }
say(typed([1, 2, 3]), typed([0.5, 1.5]), typed([1, , 3]), typed([, 0.5]), typed([]), typed([1, "x"]), typed(new Array(3)));
function wide(list) { return [4294967294 in list, 4294967295 in list, 4294967296 in list, -1 in list, 0.5 in list, 2147483648 in list, "0" in list, "01" in list]; }
const large = [1]; large[4294967294] = 2;
say(wide([1]), wide(large), wide(Object.assign([1], { 4294967295: "x", "-1": "y", 0.5: "z" })));
function changes() { const seen = []; for (const act of [l => l.pop(), l => { l.length = 1; }, l => l.unshift(0), l => { l[0] = 0.5; }, l => { delete l[0]; }, l => { l[1] = "t"; }]) { const list = [1, 2, 3, 4]; seen.push(list.reduceRight((s, x, k) => { if (k === 2) act(list); return s + String(x) + k; }, "")); } return seen; }
say(changes(), changes());
say(calls);
for (const line of lines) console.log(line);
