// Every handler x every target x every receiver x every access x every key, each three times at warm sites: what is answered, what is thrown and what the traps saw, as one sum for each handler and target. With the argument "all" every line is printed.
var mark = Symbol("mark");
var keys = ["wanted", "other", mark, Symbol.iterator, 0, "0", 7, "-1", "1.5", "__proto__", "length", "constructor", "", "get", "has", "set"];
var log = [];
function show(v) {
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return "function";
  if (typeof v === "bigint") return v + "n";
  if (v === null) return "null";
  if (typeof v === "object") return Array.isArray(v) ? "array" : "object";
  if (Object.is(v, -0)) return "-0";
  return typeof v === "string" ? (v.length > 24 ? "a long text" : JSON.stringify(v)) : String(v);
}
var accesses = {
  getWanted: function (o) { return o.wanted; },
  getOther: function (o) { return o.other; },
  getLength: function (o) { return o.length; },
  getKey: function (o, k) { return o[k]; },
  callWanted: function (o) { return typeof o.wanted === "function" ? "f" : o.wanted; },
  method: function (o) { return o.wanted(); },
  hasWanted: function (o) { return "wanted" in o; },
  hasOther: function (o) { return "other" in o; },
  hasKey: function (o, k) { return k in o; },
  setWantedSloppy: function (o, k, v) { o.wanted = v; return "stored"; },
  setOtherSloppy: function (o, k, v) { o.other = v; return "stored"; },
  setKeySloppy: function (o, k, v) { o[k] = v; return "stored"; },
  setWantedStrict: function (o, k, v) { "use strict"; o.wanted = v; return "stored"; },
  setOtherStrict: function (o, k, v) { "use strict"; o.other = v; return "stored"; },
  setKeyStrict: function (o, k, v) { "use strict"; o[k] = v; return "stored"; },
  addTo: function (o) { o.wanted += 1; return o.wanted; },
  destructure: function (o) { var { wanted, other } = o; return show(wanted) + show(other); },
  optional: function (o) { return o?.wanted?.length; },
};
var usesKey = { getKey: 1, hasKey: 1, setKeySloppy: 1, setKeyStrict: 1 };
function note() { log.push(Array.prototype.map.call(arguments, show).join(",")); }
var answers = [true, false, 0, 1, "", "x", null, undefined, NaN, {}, 0n, 1n, -0, mark];
var handlers = {
  forwards: function () { return { get(t, k, r) { note("get", k, r === this.r); return t[k]; }, has(t, k) { note("has", k); return k in t; }, set(t, k, v, r) { note("set", k, v); t[k] = v; return true; } }; },
  reflects: function () { return { get: Reflect.get, has: Reflect.has, set: Reflect.set }; },
  empty: function () { return {}; },
  nullProto: function () { var h = Object.create(null); h.get = function (t, k) { note("get", k); return 1; }; h.has = function () { return true; }; h.set = function () { return true; }; return h; },
  throws: function () { return { get() { throw new RangeError("get"); }, has() { throw new RangeError("has"); }, set() { throw new RangeError("set"); } }; },
  throwsOdd: function () { return { get() { throw 1; }, has() { throw null; }, set() { throw undefined; } }; },
  notCallable: function () { return { get: 1, has: "x", set: {} }; },
  nulls: function () { return { get: null, has: undefined, set: null }; },
  getters: function () { var n = 0; return { get get() { note("read get", ++n); return function (t, k) { return n; }; }, get has() { note("read has", ++n); return function () { return n & 1; }; }, get set() { note("read set", ++n); return function () { return n & 1; }; } }; },
  gettersThrow: function () { return { get get() { throw new SyntaxError("g"); }, get has() { throw new SyntaxError("h"); }, get set() { throw new SyntaxError("s"); } }; },
  gettersUndefined: function () { return { get get() { note("read get"); }, get has() { note("read has"); }, get set() { note("read set"); } }; },
  ofClass: function () { class H { get(t, k) { note("class get", k); return 2; } has(t, k) { note("class has", k); return false; } set(t, k, v) { note("class set", k, v); return true; } } return new H; },
  inherited: function () { return Object.create(Object.create({ get(t, k) { return "far"; }, has() { return true; }, set() { return false; } })); },
  frozen: function () { return Object.freeze({ get(t, k) { return "frozen"; }, has() { return false; }, set() { return true; } }); },
  proxied: function () { return new Proxy({ get(t, k) { return "inner"; } }, { get(t, k) { note("handler asked", k); return t[k]; } }); },
  bound: function () { return { get: function (a, t, k) { return a; }.bind(null, "bound"), has: function (a) { return a; }.bind(null, true), set: function (a) { return a; }.bind(null, false) }; },
  arrows: function () { return { get: (t, k) => typeof k, has: (t, k) => typeof k === "string", set: (t, k, v) => v !== 2 }; },
  callableProxies: function () { return { get: new Proxy(function (t, k) { return "cp"; }, {}), has: new Proxy(function () { return true; }, {}), set: new Proxy(function () { return true; }, {}) }; },
  asyncs: function () { return { get: async function () { return 1; }, has: async function () { return false; }, set: function* () { return false; } }; },
  classes: function () { return { get: class {}, has: class {}, set: class {} }; },
  freezesTarget: function () { return { get(t, k) { Object.freeze(t); return 5; }, has(t, k) { Object.freeze(t); return false; }, set(t, k, v) { Object.freeze(t); return true; } }; },
  definesOnTarget: function () { return { get(t, k) { try { Object.defineProperty(t, k, { value: 1, configurable: false, writable: false }); } catch (e) {} return 5; }, has(t, k) { try { Object.defineProperty(t, k, { value: 1, configurable: false }); } catch (e) {} return false; }, set(t, k, v) { try { Object.defineProperty(t, k, { value: 1, configurable: false, writable: false }); } catch (e) {} return true; } }; },
  usesArguments: function () { return { get() { return arguments.length + ":" + (this === arguments[2]); }, has() { return arguments.length === 2; }, set() { note("args", arguments.length); return arguments.length === 4; } }; },
};
answers.forEach(function (a, i) { handlers["answers" + i] = function () { return { get() { return a; }, has() { return a; }, set() { return a; } }; }; });
var targets = {
  empty: function () { return {}; },
  has: function () { return { wanted: 1, other: "o" }; },
  method: function () { return { wanted() { return this === undefined ? "u" : typeof this; } }; },
  frozen: function () { return Object.freeze({ wanted: 1, [mark]: 2, 0: 3 }); },
  sealed: function () { return Object.seal({ wanted: 1 }); },
  closed: function () { return Object.preventExtensions({ wanted: 1 }); },
  fixedValue: function () { return Object.defineProperty({}, "wanted", { value: 1 }); },
  fixedWritable: function () { return Object.defineProperty({}, "wanted", { value: 1, writable: true }); },
  getterOnly: function () { return Object.defineProperty({}, "wanted", { get() { return 1; } }); },
  setterOnly: function () { return Object.defineProperty({}, "wanted", { set(v) {} }); },
  looseAccessor: function () { return { get wanted() { return this; }, set wanted(v) { note("setter", v, typeof this); } }; },
  grown: function () { var t = { a: 1 }; t.wanted = 1; t.z = 2; t[mark] = 3; return t; },
  shrunk: function () { var t = { wanted: 1, other: 2 }; delete t.wanted; return t; },
  array: function () { return [1, 2]; },
  frozenArray: function () { return Object.freeze([1, 2]); },
  fn: function () { return function wanted(a, b) {}; },
  bare: function () { return Object.create(null); },
  instance: function () { class T { constructor() { this.wanted = 1; } get other() { return "getter"; } } return new T; },
  proxy: function () { return new Proxy({ wanted: 1 }, { get(t, k) { note("inner get", k); return t[k]; }, has(t, k) { note("inner has", k); return k in t; }, set(t, k, v) { note("inner set", k); t[k] = v; return true; } }); },
  bareProxy: function () { return new Proxy({ wanted: 1 }, {}); },
  map: function () { return new Map; },
  text: function () { return new String("ab"); },
};
var receivers = {
  itself: function (p) { return p; },
  below: function (p) { return Object.create(p); },
  belowWithOwn: function (p) { var o = Object.create(p); Object.defineProperty(o, "other", { value: "own", writable: true, configurable: true, enumerable: true }); return o; },
  around: function (p) { return new Proxy(p, {}); },
  aroundTrapped: function (p) { return new Proxy(p, { get(t, k, r) { note("outer get", k); return Reflect.get(t, k, r); }, has(t, k) { note("outer has", k); return Reflect.has(t, k); }, set(t, k, v, r) { note("outer set", k); return Reflect.set(t, k, v, r); } }); },
};
function run(name, o, k, v) {
  var text;
  try { text = show(accesses[name](o, k, v)); } catch (e) { text = "threw " + (e && e.constructor ? e.constructor.name + ": " + e.message : show(e)); }
  return text;
}
// The sites are warm before anything is printed.
var warm = new Proxy({ wanted: function () { return 1; } }, handlers.forwards());
for (var i = 0; i < 200; i++) for (var name in accesses) run(name, warm, keys[i % 4], i);
log.length = 0;
var lines = 0, sum = 0;
function tell(text) { lines++; for (var i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; if (process.argv[2] === "all") console.log(text); }
var section = [];
for (var h in handlers) for (var t in targets) {
  sum = 0;
  for (var r in receivers) for (var name in accesses) {
    var list = usesKey[name] ? keys : [undefined];
    for (var k of list) {
      var handler = handlers[h](), proxy = new Proxy(targets[t](), handler), o = receivers[r](proxy);
      try { handler.r = o; } catch (e) {}
      var got = [run(name, o, k, 2), run(name, o, k, 1), run(name, o, k, 2)];
      tell([h, t, r, name, show(k)].join(" ") + ": " + got.join(" | ") + " ; " + log.join(" ")); log.length = 0;
    }
  }
  section.push(h + "/" + t + " " + sum);
}
console.log(section.join("\n"));
console.log(lines);
