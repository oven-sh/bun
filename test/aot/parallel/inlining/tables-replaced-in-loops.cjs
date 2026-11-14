// Methods search an array that other methods replace, inside loops that count first: whoever changes a method, the array or an entry in the middle of an iteration, each step is done once.
const out = [];
function say(...values) { out.push(values.map(v => Object.is(v, -0) ? "-0" : String(v)).join(" ")); }
function Entry(k, v) { this.k = k; this.v = v; this.n = null; }
function Table(size) { this.list = new Array(size); this.count = 0; this.changes = 0; this.limit = size; }
Table.prototype = {
  find: function (k, i) { var e = this.list[i]; while (e && e.k !== k) e = e.n; return e; },
  make: function (k, i) { var e = new Entry(k, null); e.n = this.list[i]; this.list[i] = e; return e; },
  grow: function () { var old = this.list; this.list = new Array(old.length * 2); for (var i = 0; i < old.length; i++) { var e = old[i]; while (e) { var j = e.k & (this.list.length - 1), n = e.n; e.n = this.list[j]; this.list[j] = e; e = n; } } this.limit *= 2; },
  put: function (k, v) { var i = k & (this.list.length - 1); var e = this.find(k, i); if (!e) { this.changes++; e = this.make(k, i); if (++this.count > this.limit) this.grow(); } var was = e.v; e.v = v; return was; },
  get: function (k) { var e = this.find(k, k & (this.list.length - 1)); return e ? e.v : null; },
};
function fill(t, n, at, change) { let sum = 0; for (let k = 0; k < n; k++) { if (k === at) change(t); sum += t.put(k, k + 1) === null ? 1 : 0; } return sum; }
function read(t, n) { let sum = 0; for (let k = 0; k < n; k++) sum += t.get(k) | 0; return sum; }
function tell(name, change) { const t = new Table(4); let result; try { result = fill(t, 50, 20, change); } catch (e) { result = e.constructor.name; } let sum; try { sum = read(t, 50); } catch (e) { sum = e.constructor.name; } say(name, result, t.count, t.changes, t.list && t.list.length, sum); }
const none = () => {};
tell("none", none);
tell("own make", t => { t.make = function (k, i) { this.changes += 100; const e = { k, v: 7, n: this.list[i] }; return this.list[i] = e; }; });
tell("own find", t => { t.find = () => undefined; });
tell("own grow", t => { t.grow = function () { this.list = [null, null, null, null]; this.limit = 1e9; }; });
tell("frozen", t => Object.freeze(t.list));
tell("sealed", t => Object.seal(t.list));
tell("accessor", t => Object.defineProperty(t.list, "1", { get() { say("get"); return null; }, set() { say("set"); }, configurable: true }));
tell("empty", t => { t.list.length = 0; });
tell("constant", t => { t.list = [null, null, null, null, null, null, null, null]; });
tell("numbers", t => { t.list = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]; });
tell("integers", t => { t.list = [0, 0, 0, 0, 0, 0, 0, 0]; });
tell("bytes", t => { t.list = new Uint8Array(8); });
tell("proxy", t => { t.list = new Proxy(t.list, {}); });
tell("parent", t => Object.setPrototypeOf(t.list, { __proto__: Array.prototype, get 40() { say("above"); return null; } }));
tell("deleted", t => { delete t.list[1]; });
tell("fraction", t => { t.changes = 0.5; });
tell("text", t => { t.changes = "x"; });
tell("exact", t => { t.changes = 9007199254740991; });
tell("accessor of count", t => { let held = t.changes; Object.defineProperty(t, "changes", { get() { return held; }, set(v) { held = v; }, configurable: true }); });
tell("gone", t => { t.list = null; });
tell("entry", t => { t.list[2] = { k: 2, v: "plain", n: null }; });
tell("word", t => { t.list[2] = "word"; });
tell("frozen table", t => Object.freeze(t));
const make = Table.prototype.make;
tell("replaced make", () => { Table.prototype.make = function (k, i) { say("new", k); Table.prototype.make = make; return make.call(this, k, i); }; });
tell("replaced entry", () => { Entry.prototype.n = new Entry(99, 99); });
tell("again", none);
console.log(out.join("\n"));
