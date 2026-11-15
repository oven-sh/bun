// Function evaluates the sources of functions of the file: what they make sees the global scope alone.
const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
let outer = 5; const held = { n: 7 };
function SortTemplate(comparator) {
  /** Swaps. */
  function swap(ary, x, y) { var temp = ary[x]; ary[x] = ary[y]; ary[y] = temp; }
  function doQuickSort(ary, comparator, p, r) {
    if (p < r) {
      var pivotIndex = (p + r) >> 1, i = p - 1; swap(ary, pivotIndex, r); var pivot = ary[r];
      for (var j = p; j < r; j++) if (comparator(ary[j], pivot, false) <= 0) { i += 1; swap(ary, i, j); } // the rest
      swap(ary, i + 1, j); var q = i + 1; doQuickSort(ary, comparator, p, q - 1); doQuickSort(ary, comparator, q + 1, r);
    }
  }
  return doQuickSort;
}
function cloneSort(comparator) {
  let template = SortTemplate.toString(); let templateFn = new Function(`return ${template}`)();
  return templateFn(comparator);
}
const cache = new WeakMap();
function quickSort(ary, comparator, start = 0) { let sort = cache.get(comparator); if (sort === void 0) { sort = cloneSort(comparator); cache.set(comparator, sort); } sort(ary, comparator, start, ary.length - 1); }
const up = (a, b) => a - b, down = (a, b) => b - a, byText = (a, b) => String(a) < String(b) ? -1 : 1;
for (let k = 0; k < 3; k++) for (const order of [up, down, byText]) { const list = []; for (let i = 0; i < 40; i++) list.push((i * 37 + k * 11) % 41); quickSort(list, order); say(list.join()); }
say(cloneSort(up) === cloneSort(up), cloneSort(up).name, cloneSort(up).length);
function readsOuter(x) { return typeof outer + typeof held + typeof readsOuter + x; }
say(new Function("return " + readsOuter)()(1), readsOuter(1), Function(`return ${readsOuter}`)()(2), new Function("return " + String(readsOuter))()(3));
const arrow = (a, b = 2) => { return typeof outer + a + b; }; say(new Function("return " + arrow.toString())()(1), Function("return " + arrow)()(1, 3), attempt(() => new Function("return " + (() => outer))()()));
const named = function inner(n) { return n < 2 ? 1 : n * inner(n - 1); }; say(new Function(`return ${named};`)()(6), new Function(`return ${named};`)().name);
const object = { method(a) { return a + typeof object; }, get x() { return 1; }, f: function (a) { return this === globalThis ? "global" : a; } };
say(attempt(() => new Function(`return function ${object.method}`)()(1)), attempt(() => new Function(`return ${object.method}`)()), new Function(`return ${object.f}`)()(1));
function* gen(n) { for (let i = 0; i < n; i++) yield i * 2; } say([...new Function(`return ${gen}`)()(4)].join());
async function later(x) { return typeof outer + await x; } new Function(`return ${later}`)()(9).then(v => say(v));
class Point { constructor(x) { this.x = x; } twice() { return this.x * 2; } } const P = new Function(`return ${Point}`)(); say(new P(4).twice(), P === Point, P.name);
function strict() { "use strict"; return typeof this; } function sloppy() { return typeof this; } say(new Function(`return ${strict}`)()(), new Function(`return ${sloppy}`)()(), new Function(`"use strict"; return ${sloppy}`)()());
function accents(x) { return "héllo – 日本" + x; /* ✓ */ } say(new Function(`return ${accents}`)()("!"));
function replaced(x) { return "own " + x; } replaced.toString = () => "function (x) { return 'other ' + x; }"; say(new Function(`return ${replaced}`)()(1), Function("return " + replaced)()(2), new Function(`return ${replaced.toString()}`)()(3));
{ const real = Function.prototype.toString; Function.prototype.toString = function () { return "function (x) { return 'patched ' + x; }"; }; const f = new Function(`return ${readsOuter}`)(), g = new Function(`return ${SortTemplate.toString()}`)(); Function.prototype.toString = real; say(f(1), g(2)); }
{ const real = Function; let n = 0; globalThis.Function = function (...a) { n++; return real(...a); }; const f = new Function(`return ${readsOuter}`)(); globalThis.Function = real; say(f(1), n); }
function redeclared(x) { return "first " + x; } say(new Function(`return ${redeclared}`)()(1)); redeclared = function (x) { return "second " + x; }; say(new Function(`return ${redeclared}`)()(2));
function twoOf(choose) { const a = function () { return "a" + typeof choose; }, b = function () { return "b" + typeof choose; }; return new Function(`return ${choose ? a : b}`)()(); } say(twoOf(true), twoOf(false));
function counter() { return new Function("let n = 0; return function () { return ++n; };")(); } const c1 = counter(), c2 = counter(); say(c1(), c1(), c2(), c1 === c2);
say(attempt(() => new Function("return function (")()), attempt(() => new Function("} function () {")()), attempt(() => new Function("return () => { ")()), attempt(() => new Function("return function () { return eval('1 + 1'); }")()()));
say(new Function("return this")() === globalThis, new Function("return 0")(), new Function("") + "", new Function("return () => this")()() === globalThis, attempt(() => new Function("return function () { throw new TypeError('in ' + typeof held); }")()()));
var shared = "file"; globalThis.shared = "global"; function readsShared() { return shared; } say(new Function(`return ${readsShared}`)()(), readsShared());
for (let i = 0; i < 2; i++) { const sort = new Function("return " + SortTemplate)()(up); const l = [3, 1, 2]; sort(l, up, 0, 2); say(l.join(), typeof sort.prototype, sort.hasOwnProperty("caller")); }
