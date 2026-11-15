// Methods of lists called in loops with closures written in place, which nobody types; lists of every kind, doubles among them.
// STATISTIC: NumericCallbackLists >= 5
function mapAdds(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => x + k));
  }
  return out;
}
function mapCounter(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => x + r));
  }
  return out;
}
function mapCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => twice(x) + r));
  }
  return out;
}
function mapIndex(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map((x, i) => x + i * k));
  }
  return out;
}
function mapList(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map((x, i, all) => x + all.length + i));
  }
  return out;
}
function mapObjects(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => ({ x, r })));
  }
  return out;
}
function mapTexts(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => x + ":" + r));
  }
  return out;
}
function mapThrows(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map((x, i) => { if (i === r + 1) throw new RangeError("m" + i); return x; }));
  }
  return out;
}
function filterAbove(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.filter(x => x > k));
  }
  return out;
}
function filterCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.filter(x => isOdd(x + r)));
  }
  return out;
}
function filterIndex(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.filter((x, i) => i % 2 === r % 2));
  }
  return out;
}
function filterTruth(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.filter(x => x));
  }
  return out;
}
function filterShortens(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.filter((x, i) => { if (i === 2) a.length = 4; return x !== k; }));
  }
  return out;
}
function someEqual(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.some(x => x === k));
  }
  return out;
}
function someCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.some(x => isOdd(x - r)));
  }
  return out;
}
function everyBelow(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.every(x => x < k + 100));
  }
  return out;
}
function everyCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.every((x, i) => i < 3 || isOdd(x)));
  }
  return out;
}
function findCaptured(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.find(x => x > k + r));
  }
  return out;
}
function findIndexCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.findIndex(x => twice(x) > 8 + r));
  }
  return out;
}
function findChanges(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.find((x, i) => { a[i] = r; return i === 3; }));
  }
  return out;
}
function eachSum(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let s = 0; a.forEach(x => { s += x; }); out.push(s);
  }
  return out;
}
function eachCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let s = 0; a.forEach(x => { s = s + twice(x) + r; }); out.push(s);
  }
  return out;
}
function eachStores(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    const c = []; a.forEach((x, i) => { c[i] = x; }); out.push(c);
  }
  return out;
}
function eachPushes(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    const c = []; a.forEach(x => { if (x !== k) c.push(x); }); out.push(c);
  }
  return out;
}
function eachGrows(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let n = 0; a.forEach(x => { n++; if (n < 4) a.push(k); }); out.push(n);
  }
  return out;
}
function eachSkips(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let n = 0; a.forEach((x, i) => { n++; if (i === 1) a.length = 3; }); out.push(n);
  }
  return out;
}
function eachThrows(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let n = 0; try { a.forEach(x => { if (n++ === r) throw x; }); } catch (error) { out.push("caught", error); } out.push(n);
  }
  return out;
}
function eachTexts(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    let t = ""; a.forEach(x => { t += x + r; }); out.push(t);
  }
  return out;
}
function eachField(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    a.forEach(x => { box.total += +(x ) || 0; box.seen++; }); out.push(box.total, box.seen);
  }
  return out;
}
function eachKinds(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    a.forEach((x, i) => { if (i === 2) (a )[4] = "t"; if (i === 3) (a )[0] = 0.25; });
  }
  return out;
}
function reduceSum(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.reduce((s, x) => s + x, 0));
  }
  return out;
}
function reduceCaptured(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.reduce((s, x) => s + x * k - r, 0));
  }
  return out;
}
function reduceCalls(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.reduce((s, x) => s + twice(x), k));
  }
  return out;
}
function reduceFirst(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push((a ).reduce((s, x) => s + x));
  }
  return out;
}
function reduceList(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.reduce((s , x) => { s.push(x); return s; }, []));
  }
  return out;
}
function reduceIndex(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.reduce((s, x, i) => s + i * r, 0));
  }
  return out;
}
function chain(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => x + k).filter(x => x !== r).reduce((s, x) => s + x, 0));
  }
  return out;
}
function nested(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(x => a.filter(y => y === x).length + r));
  }
  return out;
}
function returns(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push((() => { for (const x of a) if (a.some(y => y === x && r > 1)) return x; return "none"; })());
  }
  return out;
}
function thisArg(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push((a ).map(function (           x ) { return this.k + x; }, { k }));
  }
  return out;
}
function yields(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(function* (x ) { yield x + r; }).map(g => (g ).next().value));
  }
  return out;
}
function argumentsCounted(a , k , n ) {
  const out = [];
  for (let r = 0; r < n; r++) {
    out.push(a.map(function () { return arguments.length + r; }));
  }
  return out;
}
const box = { total: 0, seen: 0 };
let seen = 0;
class Own extends Array {}
function twice(x ) { seen++; return x + x; }
function isOdd(x ) { seen++; return x % 2 === 1; }
const kinds = {
  "ints": () => [1, 2, 3, 4, 5],
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5],
  "late double": () => [1, 2, 3, 4, 5.5],
  "whole doubles": () => (() => { const l = [0.5, 2, 3, 4, 5]; l[0] = 1; return l; })(),
  "mixed": () => [1, "2", null, 4.5, undefined],
  "texts": () => ["a", "b", "c", "d", "e"],
  "objects": () => [{ valueOf() { seen += 10; return 3; } }, 2, 3, 4, 5],
  "holes": () => [1, , 3, , 5],
  "holes of doubles": () => [0.5, , 2.5, , 4.5],
  "room": () => new Array(5),
  "empty": () => [],
  "one": () => [7],
  "not a number": () => [NaN, -0, Infinity, 0, 1],
  "far": () => [2147483647, 2147483648, -2147483649, 1, 2],
  "frozen": () => Object.freeze([1, 2, 3, 4, 5]),
  "bigints": () => [1n, 2n, 3n, 4n, 5n],
  "heir": () => Own.from([1, 2.5, 3, 4, 5]),
  "own method": () => Object.assign([1, 2, 3, 4, 5], { map: () => ["own"], some: () => "own", forEach: () => "own", reduce: () => "own", filter: () => ["own"], every: () => "own", find: () => "own", findIndex: () => -7 }),
  "own prototype": () => Object.setPrototypeOf([1, , 3, 4], Object.create(Array.prototype, { 1: { value: 9 } })),
  "view": () => new Float64Array([0.5, 1, 2, 3, 4]),
  "text": () => "01234",
  "like": () => ({ length: 3, 0: 1, 1: 2, 2: 3, map: Array.prototype.map, some: Array.prototype.some, every: Array.prototype.every, find: Array.prototype.find, findIndex: Array.prototype.findIndex, filter: Array.prototype.filter, forEach: Array.prototype.forEach, reduce: Array.prototype.reduce }),
  "nothing": () => undefined,
  "proxy": () => new Proxy([1, 2, 3, 4, 5], { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }),
  "accessor": () => Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { seen += 100; return 8; }, set() { seen += 1000; }, configurable: true }),
};
const captures = JSON.parse('[1, 2.5, "t", null, -3]');
const functions = { mapAdds, mapCounter, mapCalls, mapIndex, mapList, mapObjects, mapTexts, mapThrows, filterAbove, filterCalls, filterIndex, filterTruth, filterShortens, someEqual, someCalls, everyBelow, everyCalls, findCaptured, findIndexCalls, findChanges, eachSum, eachCalls, eachStores, eachPushes, eachGrows, eachSkips, eachThrows, eachTexts, eachField, eachKinds, reduceSum, reduceCaptured, reduceCalls, reduceFirst, reduceList, reduceIndex, chain, nested, returns, thisArg, yields, argumentsCounted };
const word = (value ) => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : value !== null && typeof value === "object" ? (Array.isArray(value) ? "[" + show(value) + "]" : "{" + Object.keys(value) + "}") : String(value));
function show(list ) {
  const all = [];
  for (let i = 0; i < list.length && i < 12; i++) all.push(i in list ? word(list[i]) : "hole");
  return all.join();
}
const log = [];
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kind of Object.keys(kinds)) {
    for (const k of captures) {
      for (const name of Object.keys(functions)) {
        seen = 0;
        box.total = box.seen = 0;
        const a = kinds[kind] ();
        let answer ;
        try {
          answer = show(functions[name] (a, k, 3));
        } catch (error ) {
          answer = error.name + " " + (error instanceof RangeError ? error.message : "");
        }
        log.push(name + " " + kind + " " + word(k) + ": " + answer + " | " + (Array.isArray(a) ? show(a) : "") + " " + seen);
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 97) console.log(log[i].slice(0, 150));
