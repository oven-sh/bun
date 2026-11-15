// A setter that a loop over names or a helper defines is found and tested before a loop that changes nothing it depends on. What changes between two runs of the loop, and what the loop itself writes, is seen.
// STATISTIC: SettersExpectedInLoops >= 8
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));

function reactive(target, key, value) {
  Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { return value; }, set(x) { if (x !== value) value = x; } });
}
const data = { count: 0, total: 1, name: "a" };
for (const key of Object.keys(data)) reactive(data, key, data[key]);
function counts(turns) { let n = 0; for (let k = 0; k < turns; k++) { data.count = k & 7; n += data.count + data.total; } return n; }
function stores(turns, value) { for (let k = 0; k < turns; k++) data.total = value; return data.total; }
function storesAndReplaces(turns, at) {
  let n = 0;
  for (let k = 0; k < turns; k++) {
    if (k === at) Object.defineProperty(data, "count", { configurable: true, get() { return -100; }, set(x) { n += x * 1000; } });
    data.count = k & 3;
    n += data.count;
  }
  return n;
}

class Context {
  constructor() { this.body = 1; this.status = 200; this.calls = 0; }
}
for (const key of ["first", "second"]) Object.defineProperty(Context.prototype, key, { configurable: true, get() { return this.body + key.length; }, set(v) { this.calls++; this.body = v; } });
const context = new Context(), other = new Context();
function ofPrototype(c, turns) { let n = 0; for (let k = 0; k < turns; k++) { c.first = k & 7; n += c.first + c.second; } return n; }
function ofBoth(turns) { let n = 0; for (let k = 0; k < turns; k++) { const c = k & 1 ? context : other; c.second = k; n += c.body; } return n; }
function compound(c, turns) { for (let k = 0; k < turns; k++) c.second += 2; return c.body; }

const all = () => tell(() => counts(0), () => counts(3), () => counts(200), () => stores(50, 4), () => ofPrototype(context, 100), () => ofBoth(40), () => compound(other, 30), () => [context.calls, other.calls]);
all(); all();
tell(() => stores(20, "text"), () => stores(20, NaN), () => stores(20, -0), () => stores(20, undefined)); all();
tell(() => storesAndReplaces(50, 20)); all();
Object.defineProperty(data, "total", { configurable: true, get() { return 5; } }); all();
Object.defineProperty(data, "count", { configurable: true, writable: true, value: 9 }); all();
Object.defineProperty(data, "count", { configurable: true, writable: false, value: 9 }); all();
delete data.count; all();
const above = { get count() { return 77; }, set count(x) { lines.push("from above " + x); throw new RangeError("no count"); } };
Object.setPrototypeOf(data, above); all();
Object.setPrototypeOf(data, Object.prototype);
for (const key of ["late", "later"]) reactive(data, key, 1);
function storesLate(turns) { let n = 0; for (let k = 0; k < turns; k++) { data.late = k; n += data.later + data.late; } return n; }
tell(() => storesLate(40)); tell(() => storesLate(40));
Object.freeze(data); all(); tell(() => storesLate(10));
Object.defineProperty(context, "first", { configurable: true, writable: true, value: 3 }); all();
Object.defineProperty(Context.prototype, "second", { configurable: true, set(v) { throw new SyntaxError("second " + v); } }); all();
Object.setPrototypeOf(other, { set second(v) { this.calls += 10; }, get second() { return 1; } }); all();

// Receivers whose stores go their own way.
const keys = ["length", "first", "name", "lastIndex"];
function onAny(target) { for (const key of keys) try { Object.defineProperty(target, key, { configurable: true, get() { return 1; }, set(x) { lines.push(key + " " + x); } }); } catch (e) { lines.push(key + ": " + e.constructor.name); } return target; }
const receivers = [onAny({}), onAny([1, 2]), onAny(function f(a) {}), onAny(new Proxy({}, {})), onAny(/x/g), onAny(Object.create(new Proxy({}, { set(t, k, v) { lines.push("trap " + String(k)); return true; } }))), onAny(new (class extends Array {})())];
function onEach() { for (let k = 0; k < receivers.length * 2; k++) { const r = receivers[k % receivers.length]; r.first = k; r.length = k; r.name = k; } return receivers.length; }
tell(onEach); tell(onEach);
const last = receivers[0];
function onOne(turns) { for (let k = 0; k < turns; k++) last.first = k; return last.first; }
tell(() => onOne(3)); tell(() => onOne(2));
console.log(lines.join("\n"));
