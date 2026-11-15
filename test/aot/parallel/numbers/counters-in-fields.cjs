// Fields that only count by one hold exact integers: they stop at 2^53, as a double does, and every other number that is stored there is read back as it is.
const out = [];
function told(v) { return Object.is(v, -0) ? "-0" : typeof v + String(v); }
function say(...values) { out.push(values.map(told).join(" ")); }
class Up { constructor(n) { this.n = n; } step() { this.n++; return this.n; } before() { return this.n++; } add() { this.n += 1; return this.n; } many(k) { for (let i = 0; i < k; i++) this.n++; return this.n; } key(list) { return list[this.n++]; } over(m) { return ++this.n > m; } }
class Down { constructor(n) { this.n = n; } step() { this.n--; return this.n; } many(k) { for (let i = 0; i < k; i++) this.n -= 1; return this.n; } }
function Both(n) { this.n = n; this.last = n; }
Both.prototype = { up: function () { this.n++; }, down: function () { this.n--; }, keep: function () { this.last = this.n; }, changed: function () { return this.n != this.last; } };
function Below(n) { Both.call(this, n); this.own = 0; }
Below.prototype = { walk: function (list) { while (this.n < list.length) { if (!list[this.n]) this.n++; else return true; } return false; }, next: function (list) { return this.walk(list) ? list[this.n++] : "end"; } };
Below.prototype.__proto__ = Both.prototype;
const limit = 9007199254740992;
class AtEnd { constructor() { this.n = 9007199254740990; this.m = -9007199254740990; } up() { this.n++; return this.n < 3 ? "few" : this.n; } down() { return --this.m < 0 ? this.m : "many"; } upBy(k) { for (let i = 0; i < k; i++) this.n += 1; return this.n > 0 ? this.n : "none"; } isPast() { return this.n > 9007199254740992; } difference() { return this.n - 9007199254740990; } }
function Ends() { this.n = 9007199254740991; } Ends.prototype = { step: function () { return this.n > 1 ? this.n++ : "one"; }, key: function (list) { return list[this.n - 9007199254740990]; } };
{ const end = new AtEnd(), ends = new Ends(), one = { n: 9007199254740992 }; for (let i = 0; i < 5; i++) { one.n++; say(end.up(), end.down(), end.isPast(), end.difference(), ends.step(), ends.n, one.n, ends.key(["a", "b", "c", "d", "e"])); } say(end.upBy(7), end.difference(), end.n % 10, end.n / 4, `${end.n}`, end.m === -end.n); }
for (const start of [0, 5, 2147483646, 4294967294, limit - 3, limit]) {
  const up = new Up(start), down = new Down(-start);
  for (let i = 0; i < 5; i++) say(up.step(), up.before(), up.add(), down.step());
  say(up.many(4), down.many(4), up.over(3), up.n % 7, up.n / 2, up.n | 0, up.n >>> 1, -up.n, 1 / down.n, up.n * up.n, `${up.n}`, up.n + 0.5, down.n === -up.n);
}
const both = new Both(limit - 1), below = new Below(0), list = [0, 0, "a", 0, "b"];
for (let i = 0; i < 4; i++) { both.up(); say(both.n, both.changed()); both.keep(); }
for (let i = 0; i < 4; i++) { both.down(); say(both.n, both.changed()); }
for (let i = 0; i < 4; i++) say(below.next(list), below.n, below.key);
const named = new Up(1), counts = { n: 3 };
for (const value of [2.5, -0, NaN, "7", undefined, null, true, 1e300, limit + 2, 3]) { const key = "n"; named[key] = value; say(named.n, named.step(), named.before(), named.n); Object.assign(counts, { n: value }); counts.n++; say(counts.n); }
for (const key of ["n", "m"]) { const any = new Up(9); Reflect.set(any, key, 0.25); any.n++; say(any.n, any.m); delete any.n; any.n++; say(any.n); }
const frozen = Object.freeze(new Up(2)); try { frozen.step(); } catch (e) { say(e.constructor.name); } say(frozen.n);
say(new Up(1).key([1, 2, 3]), JSON.stringify(new Both(limit)), structuredClone({ n: new Up(limit - 1).step() }).n);
console.log(out.join("\n"));
