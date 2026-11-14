// some over lists with holes, of every storage, and lists that the callback changes while it runs.
function leaf(x) { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? (Array.isArray(x) ? shown(x) : "object") : `${typeof x}:${String(x)}`; }
function shown(x) { if (!Array.isArray(x)) return leaf(x); const out = []; for (let i = 0; i < Math.min(x.length, 14); i++) out.push(Object.hasOwn(x, i) ? leaf(x[i]) : "hole"); return `[${x.length}:${out.join()}]`; }
const getter = () => { const a = [1, 2, , 4, 5]; Object.defineProperty(a, 2, { get() { return 33; }, configurable: true, enumerable: true }); return a; };
class Own extends Array {}
const lists = [
  () => [1, 2, 3, 4, 5, 6], () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5], () => [1, , 3, , 5, 6, ,], () => [1.5, , 3.5, , , 6.5], () => [, , , 1], () => [, 1.5], () => [,], () => [], () => new Array(5), () => ["a", , "b", 3, , null], () => ["a", "b", 1, 2.5, undefined, null],
  () => [NaN, 1, -0, , 2], () => [undefined, , undefined], () => { const a = [1, 2, 3]; a.length = 6; return a; }, () => { const a = [1.5, 2.5, 3.5]; a[7] = 8.5; return a; }, () => { const a = [1, 2, 3, 4]; delete a[1]; return a; }, () => { const a = [1.5, 2.5, 3.5, 4.5]; delete a[0]; delete a[3]; return a; },
  () => Object.freeze([1, , 3]), () => Object.seal([1.5, , 3.5]), getter, () => Own.of(1, 2, 3), () => { const a = new Own(); a[3] = 1.5; return a; }, () => { const a = []; a[100] = 1; a[3] = 2; return a; }, () => ({ length: 5, 0: 1, 2: 3.5, 4: "x" }), () => ({ length: 3 }), () => "text", () => Float64Array.of(1.5, 2, 3),
  () => { const a = [1, , 3, ,]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "inherited", 3: 7 }); return a; }, () => { const a = [1.5, , 3.5]; Object.setPrototypeOf(a, { __proto__: Array.prototype, get 1() { return 9; } }); return a; },
  () => JSON.parse("[1,2.5,3,null,5]"), () => [1, 2, 3, 4, 5, 6, 7, 8].map((x, i) => i % 3 ? x : x + 0.5), () => Array.from({ length: 12 }, (_, i) => i * i), () => { const a = [5, 4, 3, 2, 1]; a.x = 1; return a; }, () => [[1], , [2, 3]], () => { const a = [1, 2, 3, 4, 5, 6, 7]; for (let i = 0; i < 7; i += 2) delete a[i]; return a; },
];
const callbacks = [
  () => x => x > 2, () => x => false, () => x => true, () => (x, i) => i > 2, () => x => x === undefined, () => x => typeof x === "string",
  () => { let n = 0; return (x, i, a) => { if (n++ === 1) a.push?.(99); return x > 4; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 1 && Array.isArray(a) && !Object.isFrozen(a) && !Object.isSealed(a)) a.length = 2; return false; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 1) try { a[3] = "new"; } catch {} return false; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 0) try { a[4] = 0.5; } catch {} return false; }; },
  () => { let n = 0; return (x, i, a) => { if (n++ === 0 && Array.isArray(a) && !Object.isFrozen(a) && !Object.isSealed(a)) delete a[2]; return false; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 2) throw new RangeError("stop"); return false; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 0 && Array.isArray(a) && !Object.isFrozen(a) && !Object.isSealed(a)) { a.length = 0; a.push(7, 8, 9, 10); } return false; }; },
  () => { let n = 0; return (x, i, a) => { if (n++ === 1 && Array.isArray(a) && !Object.isFrozen(a) && !Object.isSealed(a)) Object.defineProperty(a, 3, { get() { return "got"; }, configurable: true }); return false; }; }, () => { let n = 0; return (x, i, a) => { if (n++ === 0 && typeof a === "object") try { Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "late", 2: "later" }); } catch {} return false; }; },
];
const method = (L, f) => L.some(x => f(x));
const work = process.argv.length > 99 ? null : method;
for (let l = 0; l < lists.length; l++) {
  const lines = [];
  for (const callback of callbacks) {
    const list = lists[l]();
    let answer;
    try { answer = shown(work(list, callback())); } catch (e) { answer = e.constructor.name + ":" + (e instanceof RangeError ? e.message : ""); }
    lines.push(answer + shown(list));
  }
  console.log(l, lines.join(" "));
}
