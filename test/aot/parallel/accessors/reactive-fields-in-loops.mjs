// A loop over the own names of an object defines accessors over its values: loops look them up before they begin.
// STATISTIC: SettersExpectedInLoops >= 1
// STATISTIC: GettersExpectedInLoops >= 2
const turns = Number("40");
function reactive(target) { for (const key of Object.keys(target)) { let value = target[key]; Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { return value; }, set(x) { if (x !== value) value = x; } }); } return target; }
const data = reactive({ count: 0, total: 1 });
let n = 0; for (let k = 0; k < turns; k++) { data.count = k & 7; n += data.count + data.total; }
console.log(n, JSON.stringify(data));
const define = new Function("target", "name", "descriptor", "Object.defineProperty(target, name, descriptor)");
define(data, "count", { value: 7, writable: true, enumerable: true, configurable: true });
function again(count) { let s = 0; for (let k = 0; k < count; k++) { data.count += k; s += data.count + data.total; } return s; }
console.log(again(0), again(1), again(6), JSON.stringify(data));
define(data, "total", { get() { return this.count * 2; }, configurable: true }); console.log(again(4), JSON.stringify(data));
class Cursor { constructor() { this.at = 0; this.limit = 10; } step(by) { this.at += by; if (this.at > this.limit) this.at = 0; } }
const odd = new Cursor(); let held = 0; Object.defineProperty(odd, "at", { get() { return held; }, set(x) { held = x; }, configurable: true });
function feed(cursor, count) { for (let k = 0; k < count; k++) cursor.step(k & 3); return cursor.at; }
console.log(feed(new Cursor(), 100), feed(odd, 100), feed(new Cursor(), 7), held);
