// Built-in constructors held in variables that functions may find too early.
const say = (...a) => console.log(a.join(" "));
const attempt = (f, ...a) => { try { return String(f(...a)); } catch (e) { return e.constructor.name + ": " + e.message; } };
function bytes(n) { var o = new u8(n); for (var i = 0; i < n; i++) o[i] = i * 3; return o.join() + o.subarray(1).length; }
function pair(a, b) { var o = new u16([a, b]); o[0] += o[1]; return o[0] + ":" + o.constructor.name; }
function map(n) { var m = new M(); for (var i = 0; i < n; i++) m.set(i & 3, i); return [...m].join(); }
function set(n) { var m = new S([n, n, 1]); return m.size; }
function list(n) { var l = new A(n); l[0] = n; return l.length + ":" + l; }
function date(n) { return new D(n).getTime(); }
function error(n) { var e = new E("at " + n); return e.message + e.name; }
function regexp(n) { var r = new R("a" + n, "g"); return r.source + r.flags; }
function object(n) { var o = new O(); o.n = n; return JSON.stringify(o); }
function promise() { return typeof new P(r => r(1)).then; }
function text(n) { var s = new T(n); return typeof s + s.length; }
function weak(n) { var w = new W(), k = {}; w.set(k, n); return w.get(k); }
function buffer(n) { var b = new B(n), v = new V(b); v.setInt8(0, n); return v.getInt8(0) + ":" + b.byteLength; }
function proxy(n) { var p = new X({ n }, {}); return p.n; }
function kept(n) { var o = new Any(n); return o.length + o.constructor.name; }
function inLoop(n) { var t = 0; for (var i = 0; i < n; i++) { var o = new u8(i); t += o.length; if (i === 5) t += new u16(2).byteLength; } return t; }
function caught(n) { var t = 0; for (var i = 0; i < n; i++) { try { t += new Late(i).length; } catch (e) { t += 1000; if (i === 3) Late = Uint8Array; } } return t; }
function symbol() { var s = new Sy("x"); return s; }
function number(n) { var o = new N(n); return o + 1; }
const all = { bytes, pair, map, set, list, date, error, regexp, object, promise, text, weak, buffer, proxy, kept, inLoop, symbol, number };
function every(when) { for (const [name, f] of Object.entries(all)) say(when, name, attempt(f, 3, 4)); }
every("early"); say("caught", attempt(caught, 8));
var u8 = Uint8Array, u16 = Uint16Array, M = Map, S = Set, A = Array, D = Date, E = RangeError, R = RegExp, O = Object, P = Promise, T = String, W = WeakMap, B = ArrayBuffer, V = DataView, X = Proxy, Sy = Symbol, N = Number, Late;
var Any = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
for (let turn = 0; turn < 3; turn++) every("then");
say("caught", attempt(caught, 8)); say("caught", attempt(caught, 8));
Late = undefined; say("caught", attempt(caught, 8)); Late = null; say("caught", attempt(caught, 2)); Late = 5; say(attempt(caught, 2)); Late = { length: 1 }; say(attempt(caught, 2)); Late = () => 1; say(attempt(caught, 2));
