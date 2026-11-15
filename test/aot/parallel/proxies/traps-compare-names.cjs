// Traps that compare the key with names, as the handlers of frameworks do: for keys of every kind.
const log = [];
const raws = new WeakMap(), proxies = new WeakMap();
function makeGet(isReadonly = false, isShallow = false) {
  return function (target, key, receiver) {
    if (key === "__isReactive") return !isReadonly;
    if (key === "__isReadonly") return isReadonly;
    if (key === "__isShallow") return isShallow;
    if (key === "__raw" && proxies.get(target) === receiver) return target;
    if (key === "Āwide") return "wide";
    const value = Reflect.get(target, key, receiver);
    if (!value) return value;
    return isShallow ? value : typeof value === "object" ? reactive(value) : value;
  };
}
const get = makeGet(), readonlyGet = makeGet(true), shallowGet = makeGet(false, true);
const handler = {
  get,
  set(target, key, value, receiver) {
    if (key === "locked" || key === "frozen" || key === "sealed") return false;
    log.push(typeof key === "symbol" ? "symbol" : key);
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    return key === "everywhere" || key === "always" || key === "a" + "ll" || Reflect.has(target, key);
  },
};
const readonly = { get: readonlyGet, set: () => true };
const shallow = Object.assign({}, handler, { get: shallowGet });
class Handler {
  constructor(prefix) { this.prefix = prefix; }
  get(target, key) {
    if (key === "first") return this.prefix + 1;
    else if (key === "second") return this.prefix + 2;
    else if (key === "third" || key === "fourth" || key === "fifth") return this.prefix + key;
    return target[key];
  }
  has(target, key) { switch (key) { case "one": case "two": case "three": return true; } return key in target; }
}
function create(target, handlers) {
  const proxy = new Proxy(target, handlers);
  proxies.set(target, proxy);
  return proxy;
}
function reactive(value) { return proxies.get(value) || create(value, handler); }
function show(v) { return typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : String(v) : Array.isArray(v) ? "array" : "object"; }
const long = "__is" + "x".repeat(40).slice(0, 0) + ["Rea", "ctive"].join("");
const keys = ["__isReactive", "__isReadonly", "__isShallow", "__raw", "Āwide", "a", "b", "c", "0", 1, "01", "", long, "__isReactive ".trim(), "__isReactivE", "__isshallow", "__ra" + "w", "constructor", "toString", "length", Symbol.iterator, Symbol.toPrimitive, Symbol("__raw"), "first", "second", "third", "fourth", "fifth", "sixth", "everywhere", "always", "all", "one", "two", "three", "locked", "frozen", "sealed", "Ā".repeat(12), 1.5, -0, NaN, null, undefined, true, 12n, { toString: () => "__isReadonly" }, ["__raw"]];
const targets = [{ a: 1, b: { c: 2 }, c: -0 }, [1, { a: 2 }, "x"], Object.create({ a: 5, get b() { return this === undefined; } }), Object.assign(Object.create(null), { a: "text", locked: 1 }), new (class { a = 1; get b() { return this.a; } })()];
for (let turn = 0; turn < 3; turn++) {
  for (const target of targets) {
    const views = [reactive(target), new Proxy(target, readonly), new Proxy(target, shallow), new Proxy(target, new Handler("h" + turn))];
    for (const p of views) {
      const line = [];
      for (const key of keys) {
        try { line.push(show(p[key])); } catch (e) { line.push(e.name); }
        try { line.push(key in p); } catch (e) { line.push(e.name); }
      }
      line.push(show(p.__isReactive), show(p.__isReadonly), show(p.__isShallow), show(p.__raw), show(p.a), show(p.b), show(p.first), "a" in p, "everywhere" in p, "two" in p);
      for (const key of ["a", "locked", "frozen", "sealed", "d", "0"]) { try { p[key] = turn; } catch (e) { line.push(e.name); } }
      try { "use strict"; p.locked = 1; p.sealed = 2; p.d = 3; } catch (e) { line.push(e.name); }
      console.log(line.join(), log.splice(0).join());
    }
  }
  if (turn === 1) { handler.get = function (target, key) { return key === "a" ? "replaced" : target[key]; }; delete handler.has; readonly.get = undefined; Handler.prototype.get = (t, k) => "late " + String(typeof k); }
}
