// The library asks what kind of cell a value is ($isMap, $isSet, $isPromise, $isRegExpObject, $isProxyObject ..) where its methods are borrowed, awaited, inspected or cloned. Each method is called on every kind of value: instances, instances of classes below, the prototype objects, objects under the prototypes, proxies of instances, and primitives.
class M extends Map {} class S extends Set {} class P extends Promise {} class R extends RegExp {}
const values = () => [new Map([[1, 2]]), new M([[1, 2]]), Map.prototype, Object.create(Map.prototype), new Proxy(new Map(), {}), new Set([1]), new S([1]), Set.prototype, Object.create(Set.prototype), new Proxy(new Set(), {}), Promise.resolve(1), P.resolve(1), Promise.prototype, Object.create(Promise.prototype), new Proxy(Promise.resolve(1), {}), /a/g, new R("a"), RegExp.prototype, Object.create(RegExp.prototype), new Proxy(/a/, {}), new WeakMap(), new WeakSet(), [], {}, () => 1, "text", 5, null, undefined, Symbol.iterator, 5n, new Date(0), new Error("e"), new Uint8Array(1), new ArrayBuffer(1), new DisposableStack(), new AsyncDisposableStack()];
function attempt(run) { try { const r = run(); return r instanceof Promise ? "promise" : typeof r === "object" && r !== null ? Object.prototype.toString.call(r) : String(r); } catch (e) { return e.constructor.name; } }
const asked = {
  mapForEach: v => Map.prototype.forEach.call(v, () => {}),
  setForEach: v => Set.prototype.forEach.call(v, () => {}),
  mapGroupBy: v => Map.groupBy([1], () => v).size,
  then: v => Promise.prototype.then.call(v, () => {}),
  finally: v => Promise.prototype.finally.call(v, () => {}),
  resolve: v => Promise.resolve(v) === v,
  resolveBelow: v => P.resolve(v) === v,
  all: v => Promise.all([v]),
  race: v => Promise.race([v]),
  matchAll: v => typeof "aa".matchAll(v).next,
  replaceAll: v => "aa".replaceAll(v, "b"),
  startsWith: v => "aa".startsWith(v),
  includes: v => "aa".includes(v),
  split: v => "aXa".split(v).length,
  regExp: v => RegExp(v) === v,
  symbolSplit: v => RegExp.prototype[Symbol.split].call(v, "aXa").length,
  union: v => new Set([1]).union(v).size,
  isSubsetOf: v => new Set([1]).isSubsetOf(v),
  disposed: v => Reflect.get(DisposableStack.prototype, "disposed", v),
  dispose: v => DisposableStack.prototype.dispose.call(v),
  asyncDisposed: v => Reflect.get(AsyncDisposableStack.prototype, "disposed", v),
  clone: v => typeof structuredClone(v),
  inspect: v => typeof Bun.inspect(v),
  isArray: v => Array.isArray(v),
  concat: v => [0].concat(v).length,
  flat: v => [[v]].flat(2).length,
  from: v => Array.from(v).length,
  newMap: v => new Map(v).size,
  newSet: v => new Set(v).size,
  fromEntries: v => Object.keys(Object.fromEntries(v)).length,
};
for (const name in asked) { let line = ""; for (let round = 0; round < 30; round++) line = values().map(v => attempt(() => asked[name](v))).join(" "); console.log(name + ": " + line); }
process.on("unhandledRejection", () => {});
