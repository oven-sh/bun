// @ts-nocheck
// Functions that call themselves and keep their answers under integer keys: dense, sparse, deleted and inherited elements, accessors, and literals with fields beside the elements.
const log = [];
class Holder { size = 0; }
let memo = {};
function collatz(n) { const known = memo[n]; if (known !== undefined) return known; if (n <= 1) return 0; const next = n & 1 ? n * 3 + 1 : n >> 1; return (memo[n] = collatz(next) + 1); }
function paths(x, y) { if (x === 0 || y === 0) return 1; const cell = x * 1000 + y; if (cell in memo) return memo[cell]; return (memo[cell] = paths(x - 1, y) + paths(x, y - 1)); }
function fractions(n) { if (n <= 0) return 0.5; const key = n / 2; const known = memo[key]; if (known) return known; return (memo[key] = fractions(n - 1) + 0.25); }
function negative(n) { if (n <= 0) return 0; const known = memo[-n]; if (known !== undefined) return known; memo[-n] = n; return negative(n - 1) + memo[-n]; }
function removing(n) { if (n <= 0) return 1; const known = memo[n]; delete memo[n + 1]; if (known !== undefined) return known; memo[n] = n % 3 === 0 ? "s" + n : n; return removing(n - 1); }
function sum(list, i) { return i === list.length ? 0 : list[i] + sum(list, i + 1); }
function factorial(n) { return n <= 1n ? 1n : n * factorial(n - 1n); }
function choose(n, k) { return k === 0n || k === n ? 1n : choose(n - 1n, k - 1n) + choose(n - 1n, k); }
const sparse = () => { const o = {}; for (let i = 0; i < 300; i++) o[1500 + i] = i; return o; };
const withAccessor = () => { const o = { 1: 1 }; Object.defineProperty(o, 2500, { get() { log.push("a"); return 77; }, configurable: true }); o[2501] = 5; return o; };
const makers = [() => ({}), () => ({ 1: 1 }), () => ({ 1: 1, name: "m" }), () => ({ hits: 0 }), () => Object.create(null), () => ({ 1500: 7, 3: 2 }), () => ({ "0": 5, "1": 6.5 }), () => new Holder(), () => JSON.parse('{"1":1,"2":4}'),
  () => ({ get 2() { log.push("g"); return 22; }, 5: 5 }), sparse, withAccessor, () => Object.assign(Object.create({ 2: 12, 7: 17 }), { 1: 1 }), () => [0, 1, 2], () => { const a = [1, 2]; a[3000] = 4; return a; }, () => new Proxy({ 1: 1 }, {}),
  () => { const o = { x: 1 }; o[1] = 1; o[4000] = 2; delete o[1]; return o; }, () => Object.setPrototypeOf({ 1: 4 }, { 3: 33, 4000: 44 }), () => new Float64Array(8), () => new Map()];
const show = v => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v);
function call(name, f) { let answer; try { answer = show(f()); } catch (e) { answer = e.name; } return name + "=" + answer; }
makers.forEach((make, place) => {
  memo = make();
  const said = [];
  for (const n of [1, 27, 9, 97, 27]) said.push(call("c", () => collatz(n)));
  for (const n of [2, 5, 2]) said.push(call("p", () => paths(n, n + 1)));
  for (const n of [3, 8]) said.push(call("f", () => fractions(n)));
  for (const n of [4, 2]) said.push(call("n", () => negative(n)));
  for (const n of [6, 3]) said.push(call("r", () => removing(n)));
  console.log(place, said.join(" "), log.length, Object.keys(memo).length, [0, 1, 2, 3, 5, 27, 1500, 2500, 4000, 9232].map(i => call(i, () => memo[i])).join(" "));
  log.length = 0;
});
console.log([[1.5, 2, 3.25], [1, 2, 3], [], [1, , 3], [1, "2", 3], ["a", 2.5], [NaN, 1], [-0]].map(list => show(sum(list, 0))).join(" "));
console.log([0n, 1n, 5n, 30n, -3n].map(n => show(factorial(n))).join(" "), show(choose(20n, 9n)));
