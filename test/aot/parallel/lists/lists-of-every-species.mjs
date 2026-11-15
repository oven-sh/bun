const show = (x) => (typeof x === "symbol" ? "sym" : Array.isArray(x) ? "[" + x.length + "]" : typeof x === "object" && x !== null ? "o" : typeof x === "function" ? "f" : Object.is(x, -0) ? "-0" : String(x));
const makers = [
  () => [1, 2, 3, 4, 5],
  () => [1.5, 2, 3.25, 4, 5],
  () => ["a", "b", "c", "d"],
  () => [1, "a", null, undefined, 2.5, { x: 1 }, true],
  () => [{ x: 1 }, { x: 2 }, { x: 3 }],
  () => [1, , 3, , 5],
  () => [1.5, , 2.5],
  () => ["a", , "c"],
  () => [],
  () => new Array(5),
  () => new Array(0),
  () => (() => { const a = []; a.length = 6; return a; })(),
  () => (() => { const a = [1, 2, 3]; a[200000] = 7; return a; })(),
  () => Object.freeze([1, 2, 3]),
  () => Object.freeze([1.5, 2.5]),
  () => Object.freeze(["a", "b"]),
  () => Object.seal([1, 2, 3]),
  () => Object.preventExtensions(["x", "y", 3]),
  () => new (class A extends Array {})(1, 2, 3),
  () => new (class A extends Array {})(),
  () => new (class A extends Array {})("a", "b"),
  () => Object.setPrototypeOf([1, 2, , 4], { 2: "inherited" }),
  () => Object.setPrototypeOf([1, 2, , 4], Object.defineProperty({}, 2, { get() { return "above"; }, configurable: true })),
  () => Object.setPrototypeOf(["a", , "c"], Object.defineProperty([], 1, { set(v) {}, get() { return 7; }, configurable: true })),
  () => Object.setPrototypeOf([1.5, 2.5, , ], new Proxy([], {})),
  () => Object.setPrototypeOf(["a", "b"], null),
  () => Object.defineProperty([1, 2, 3], 1, { get() { return "got"; }, configurable: true }),
  () => Object.defineProperty(["a", "b", "c"], 1, { writable: false }),
  () => (function () { return arguments; })(1, "b", 3),
  () => ({ 0: "a", 1: 2, length: 3 }),
  () => ({ x: 1 }),
  () => new String("text"),
  () => new Uint8Array([1, 2, 3]),
  () => new Float64Array([1.5, 2.5]),
  () => new Proxy([1, 2, 3], {}),
  () => /(b)(c)/.exec("abcd"),
  () => "a,b,c".split(","),
  () => Object.keys({ a: 1, b: 2 }),
  () => Object.entries({ a: 1, b: 2 }),
  () => JSON.parse("[1,2,3,4]"),
  () => JSON.parse('["a",{"x":1},[2]]'),
  () => JSON.parse("[1.5,2.5]"),
  () => [1, 2, 3, 4].slice(1),
  () => [1, 2].concat(["a"]),
  () => [...new Set([3, 1, 2])],
  () => Array.from({ length: 4 }, (_, k) => k * k),
  () => new Array(4).fill(false),
  () => new Array(3).fill(null),
  () => new Array(6).fill("z", 2, 4),
  () => [...new Array(3)],
  () => [, , 1].slice(),
  () => new Array(3).slice(),
  () => (() => { const a = [1, 2, 3]; a.pop(); a.pop(); a.pop(); return a; })(),
  () => (() => { const a = ["a", "b", "c"]; a.shift(); return a; })(),
  () => (() => { const a = [1, 2, 3]; a[1] = 2.5; a[2] = "z"; return a; })(),
  () => (function (a, b) {}),
  () => undefined,
  () => null,
  () => 5,
  () => 5n,
  () => Symbol.iterator,
  () => (() => { const a = new Array(2); a.length = 40; a.length = 3; return a; })(),
];
function readOf(list, i, want) {
  const x = list[i]; return x === undefined ? "u" : typeof x + ":" + show(x);
}
function sumOf(list, i, want) {
  let s = 0; for (let k = 0; k < 4; k++) s += +list[k] || 0.5; return s;
}
function eqOf(list, i, want) {
  let c = 0; for (let k = 0; k < 4; k++) if (list[k] === list[k + 1]) c++; return c + ":" + (list[i] === want);
}
function loopOf(list, i, want) {
  let t = ""; for (let k = 0; k < list.length && k < 8; k++) t += show(list[k]) + ","; return t;
}
function ofOf(list, i, want) {
  let t = ""; for (const x of list) { t += show(x) + ";"; if (t.length > 60) break; } return t;
}
function rowsOf(list, i, want) {
  let c = 0; const all = [list, list]; for (let y = 0; y < 2; y++) for (let k = 0; k < 3; k++) if (all[y][k] !== all[0][0]) c++; return c;
}
function includesOf(list, i, want) {
  return list.includes(want) + ":" + list.indexOf(want) + ":" + list.at(-1);
}
function findOf(list, i, want) {
  return show(list.find((x) => x === want)) + list.some((x) => !x) + list.filter(Boolean).length;
}
function hasOf(list, i, want) {
  return (i in list) + ":" + Object.hasOwn(list, i) + ":" + show(list[i]?.x);
}
function destrOf(list, i, want) {
  const [a, b, ...c] = list; return show(a) + show(b) + c.length;
}
function storeOf(list, i, want) {
  list[i] = want; return show(list[i]) + list.length;
}
function bumpOf(list, i, want) {
  list[i]++; return show(list[i]);
}
function pushOf(list, i, want) {
  const n = list.push(want); return n + show(list[n - 1]);
}
function swapOf(list, i, want) {
  const x = list[0]; list[0] = list[1]; list[1] = x; return show(list[0]) + show(list[1]);
}
function fillloopOf(list, i, want) {
  for (let k = 0; k < 4; k++) list[k] = k * 1.5; return show(list[2]) + list.length;
}
function fillintOf(list, i, want) {
  for (let k = 0; k < list.length && k < 6; k++) list[k] = k; return show(list[1]) + list.length;
}
function popOf(list, i, want) {
  return show(list.pop()) + list.length;
}
function compoundOf(list, i, want) {
  list[i] += want; return show(list[i]);
}
for (const f of [readOf, sumOf, eqOf, loopOf, ofOf, rowsOf, includesOf, findOf, hasOf, destrOf, storeOf, bumpOf, pushOf, swapOf, fillloopOf, fillintOf, popOf, compoundOf]) {
  let line = f.name;
  for (let t = 0; t < 3; t++)
    for (let m = 0; m < makers.length; m++)
      for (const i of [0, 1, 2, 5]) {
        let said;
        try {
          said = f(makers[m](), i, t & 1 ? 2 : "b");
        } catch (e) {
          said = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "error";
        }
        if (t < 2) line += " " + said;
      }
  console.log(line);
}
