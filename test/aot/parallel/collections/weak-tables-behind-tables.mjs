// get, has, set, delete and add where the receiver is a Map, a Set, a weak one or a class with methods of the same names, as polyfills choose them.
{
var Out = {};
function build(Out, kind) {
  (function (factory) { var root = typeof globalThis === "object" ? globalThis : this; var exporter = make(Out); factory(exporter, root); function make(target, previous) { return function (key, value) { Object.defineProperty(target, key, { configurable: true, writable: true, value: value }); if (previous) previous(key, value); }; } })(function (exporter, root) {
    var Weak = kind === "weak" && typeof WeakMap === "function" ? WeakMap : kind === "map" ? Map : kind === "outside" ? root["Oth" + "er"] : createPoly();
    var registry = createRegistry();
    exporter("registry", registry); exporter("provider", function (o, p) { return registry.getProvider(o, p); });
    function createRegistry() {
      var table = new Weak(), first, second;
      var registry = { getProvider: getProvider, setProvider: setProvider, hasProvider: hasProvider };
      return registry;
      function getProvider(o, p) { var map = table.get(o); var provider; if (!isUndefined(map)) provider = map.get(p); if (!isUndefined(provider)) return provider; provider = "made" + String(p); if (isUndefined(map)) { map = new Map(); table.set(o, map); } map.set && map.set(p, provider); return provider; }
      function setProvider(o, p, v) { var map = table.get(o); if (isUndefined(map)) { map = new Map(); table.set(o, map); } map.set(p, v); return true; }
      function hasProvider(o, p) { var map = table.get(o); if (isUndefined(map)) return false; return map.has(p); }
    }
    function isUndefined(x) { return x === undefined; }
    function createPoly() { return (function () { function Poly() { this.keys = []; this.values = []; } Poly.prototype.has = function (k) { return this.keys.indexOf(k) >= 0; }; Poly.prototype.get = function (k) { return this.values[this.keys.indexOf(k)]; }; Poly.prototype.set = function (k, v) { this.keys.push(k); this.values.push(v); return this; }; Poly.prototype.delete = function (k) { return "poly"; }; return Poly; })(); }
  });
}
class Other { get(k) { return { get: p => "other " + String(p), set() { return 1; }, has: () => "other has" }; } has(k) { return "other has"; } set(k, v) { return "other set"; } delete(k) { return "other delete"; } }
globalThis["Oth" + "er"] = Other;
const keys = [{ a: 1 }, [2], () => 3, "text", 5], rows = [];
for (const kind of JSON.parse('["weak","map","outside","none"]')) {
  const out = {}; build(out, kind); let text = kind;
  for (let i = 0; i < 20; i++) for (const ask of [() => out.provider(keys[i % 5], i % 3), () => out.registry.hasProvider(keys[i % 5], i % 2), () => out.registry.setProvider(keys[i % 5], i % 4, "set" + i), () => out.registry.getProvider(keys[i % 5], undefined)]) { try { text += " " + String(ask()); } catch (e) { text += " " + e.constructor.name + e.message; } }
  rows.push(text);
}
console.log(rows.join("\n"));
}
const log = [], keys = [{ k: 1 }, [2], () => 3];
class Own { constructor() { this.keys = []; this.values = []; } get(k) { const i = this.keys.indexOf(k); return i < 0 ? undefined : this.values[i]; } has(k) { return this.keys.includes(k); } set(k, v) { this.keys.push(k); this.values.push(v); return this; } add(k) { return this.set(k, k); } delete(k) { const i = this.keys.indexOf(k); if (i < 0) return false; this.keys.splice(i, 1); this.values.splice(i, 1); return true; } }
const Weak = typeof WeakMap === "function" ? WeakMap : Own, providers = new Weak();
function provider(object, key) { let map = providers.get(object); if (map === undefined) { map = new Map(); providers.set(object, map); } return [map.get(key), providers.has(object)]; }
for (let i = 0; i < 300; i++) { const [value, has] = provider(keys[i % 3], i % 2 ? undefined : "k"); if (value !== undefined || !has) console.log("wrong", i); }
const show = x => (x === undefined ? "u" : typeof x === "object" && x ? "o" : typeof x === "function" ? "f" : String(x));
const calls = [(t, k) => t.get(k), (t, k) => t.has(k), (t, k, v) => t.set(k, v), (t, k) => t.delete(k), (t, k) => t.add(k)];
const makers = [() => new Map(), () => new Set(), () => new WeakMap(), () => new WeakSet(), () => new Own(), () => Object.assign(new WeakMap(), { get: () => "own" }), () => Object.create(new WeakMap()), () => null, () => 7, () => "text", () => new Proxy(new WeakMap(), {}), () => new (class extends WeakSet { has(k) { log.push("heir"); return super.has(k); } })()];
for (let turn = 0; turn < 3; turn++) {
  for (const make of makers) {
    const t = make(); let text = "";
    for (let i = 0; i < 20; i++) for (const call of calls) { const k = i % 5 === 4 ? i : keys[i % 3]; try { const x = call(t, k, i); text += x === t ? "t" : show(x); } catch (error) { text += error.constructor.name + error.message.slice(0, 50); } }
    console.log(turn, text.length, text.slice(0, 300));
  }
  console.log(log.splice(0).length);
}
