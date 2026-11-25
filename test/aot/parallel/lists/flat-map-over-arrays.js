// flatMap() over arrays of every storage, with callbacks that return arrays, elements, nested and empty arrays, that change the source, throw, or are no arrow functions.
const show = v => { if (v === undefined) return "u"; if (Object.is(v, -0)) return "-0"; if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v); if (typeof v === "string") return JSON.stringify(v); if (typeof v === "function") return "f"; if (Array.isArray(v)) { let t = "["; for (let i = 0; i < v.length; i++) t += (i ? "," : "") + (i in v ? show(v[i]) : "_"); return t + "]" + (v.constructor !== Array ? v.constructor.name : "") + Object.keys(v).filter(k => !/^\d+$/.test(k)).map(k => "." + k).join(""); } return "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join(",") + "}"; };
class List extends Array {}
class Species extends Array { static get [Symbol.species]() { return Array; } }
const makers = {
  ints: () => [1, 2, 3], none: () => [], one: () => [7], doubles: () => [1.5, NaN, -0], mixed: () => [1, "a", null, undefined, { x: 1 }, 2.5], holes: () => [1, , 3, , 5], texts: () => ["a b", "c", ""], rows: () => [[1, 2], [3], []], deep: () => [[[1], [2]], [[3, [4]]]], objects: () => [{ l: [1] }, { l: [] }, { l: [2, 3] }],
  list: () => List.from([1, 2]), species: () => Species.from([1, 2]), frozen: () => Object.freeze([1, 2]), named: () => Object.assign([1, 2], { tag: 1 }), sparse: () => { const a = [1]; a[40] = 2; return a; }, bools: () => [true, false], long: () => Array.from({ length: 40 }, (_, i) => i), undef: () => [undefined, undefined], bigs: () => [2 ** 31, 2 ** 40, -1],
};
let count = 0;
const callbacks = {
  pair: x => [x, x], same: x => x, none: () => [], wrap: x => [x], nested: x => [[x]], hole: x => [x, , x], index: (x, i) => [i, x], self: (x, i, a) => a.length, odd: (x, i) => i & 1 ? [x] : x, doubles: (x, i) => [i + 0.5], mixedOut: (x, i) => i & 1 ? [i, "t"] : [i + 0.5], text: x => String(x).split(" "), object: x => ({ x }), like: () => ({ length: 2, 0: 1, 1: 2 }), view: () => new Uint8Array([1, 2]), args: function () { return [...arguments].length; }, thisArg: function (x) { return [this === undefined ? "none" : this.k ?? typeof this, x]; },
  proxy: x => new Proxy([x, 1], {}), list: x => List.of(x, 2), inherit: x => { const a = [x]; a.length = 3; return a; }, accessors: x => { const a = [x, 1]; Object.defineProperty(a, 1, { get() { return "got" + count++; }, enumerable: true }); return a; }, shared: (() => { const s = [1, 2]; return () => s; })(), grows: (x, i, a) => { if (a.length < 6 && Object.isExtensible(a)) a.push(9); return [x]; }, shrinks: (x, i, a) => { if (Object.isExtensible(a)) a.length = Math.max(1, a.length - 1); return [x, i]; }, throws: (x, i) => { if (i === 1) throw new Error("at " + i); return [x]; }, deletes: (x, i, a) => { if (Object.isExtensible(a)) delete a[i + 1]; return [x]; }, writes: (x, i, a) => { if (Object.isExtensible(a) && i + 1 < a.length) a[i + 1] = "w" + i; return [x]; }, nan: () => [NaN, -0, 1], big: (x, i) => [2 ** 31 + i, i], big2: x => Array.from({ length: 12 }, (_, i) => i), self2: (x, i, a) => a,
};
const attempt = f => { try { return show(f()); } catch (e) { return e.name + ":" + e.message; } };
const typed = {
  ints(a) { const l = []; for (let i = 0; i < 3; i++) l.push(a.flatMap(x => [x, x + i])); return l[2]; },
  odd(a) { let r = 0; for (let i = 0; i < 4; i++) r += a.flatMap(x => x & 1 ? [x] : []).length; return r; },
  alone(a) { return a.flatMap(x => [x]); },
  called(a, f) { return a.flatMap(f); },
  withThis(a) { return a.flatMap(function (x) { return [this.k, x]; }, { k: "k" }); },
  chained(a) { return a.flatMap(x => [x, 1]).map(x => x).filter(x => x !== undefined).flatMap(x => x); },
  nested(a) { return a.flatMap(x => [1, 2].flatMap(y => [x, y])); },
  stored(a) { const r = a.flatMap(x => [x]); r.push("end"); r[0] = 0.5; return r; },
  spread(a) { return [...a.flatMap(x => [x, x])].length; },
  tail(a) { return a.flatMap(x => [x], undefined); },
};
for (let turn = 0; turn < 3; turn++) for (const [m, make] of Object.entries(makers)) {
  let line = m;
  for (const [c, callback] of Object.entries(callbacks)) { const a = make(); line += " " + c + "=" + attempt(() => a.flatMap(callback, c === "thisArg" && turn ? { k: turn } : undefined)) + (Object.isExtensible(a) && (c === "grows" || c === "shrinks" || c === "deletes" || c === "writes") ? "!" + show(a) : ""); }
  for (const [t, f] of Object.entries(typed)) { const a = make(); line += " " + t + "=" + attempt(() => f(a, callbacks.index)); }
  console.log(line);
}
const others = {
  nullThis: () => Array.prototype.flatMap.call(null, x => x), noCallback: () => [1].flatMap(), object: () => [1].flatMap({}), empty: () => [].flatMap(5), like: () => Array.prototype.flatMap.call({ length: 3, 0: [1, 2], 2: 5 }, x => x), text: () => Array.prototype.flatMap.call("ab", x => [x, x]), view: () => Array.prototype.flatMap.call(new Uint8Array([1, 2]), x => [x, 3]), args: () => (function () { return Array.prototype.flatMap.call(arguments, x => [x]); })(1, 2), apply: () => Array.prototype.flatMap.apply([1, 2], [x => [x, 0]]), bound: () => [].flatMap.bind([1, 2])(x => [x]), proxySource: () => new Proxy([1, 2], {}).flatMap(x => [x, 1]), ctor: () => { const a = [1, 2]; a.constructor = { [Symbol.species]: function (n) { return { length: n, made: 1 }; } }; return a.flatMap(x => [x]); }, ctorUndefined: () => { const a = [1]; a.constructor = undefined; return a.flatMap(x => [x]); }, ctorFive: () => { const a = [1]; a.constructor = 5; return a.flatMap(x => [x]); },
  byKey: () => { const k = "flat" + "Map"; return [1, 2][k](x => [x]); }, getterLength: () => { const o = { get length() { count++; return 2; }, 0: 1, 1: [2] }; return Array.prototype.flatMap.call(o, x => x); },
};
for (const [n, f] of Object.entries(others)) console.log(n, attempt(f));
