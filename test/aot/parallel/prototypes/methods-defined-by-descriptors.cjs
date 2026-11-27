// STATISTIC: MethodsExpectedByDescriptors >= 6
// Under: --aot-harden=proof-checks: the method that a call enters is the one that the object finds
// Under: --aot-testing=FailSpeculations: each call runs as written
// Methods that value descriptors define on the prototypes of constructor functions, most of them read-only: called, stored over, defined again, deleted, hidden by objects and by heirs, inherited.
const lines = [], line = (...words) => lines.push(words.map(String).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
let calls = 0;
class Strict { static store(o, v) { o.add = v; return "stored"; } static open(o, f) { o.open = f; return o.open(2); } static remove(o) { return delete o.size; } static size(o, f) { o.size = f; } }
function Base(kind) { this.kind = kind; this.list = null; this.count = 0; }
Base.prototype = Object.create(Object.prototype, {
  ensure: { value: function () { if (this.list) return; calls++; this.list = []; for (let i = 0; i < this.kind; i++) this.list.push(i); } },
  size: { value: function () { this.ensure(); return this.list.length; } },
  total: { value: function () { let n = 0; this.ensure(); for (let i = 0; i < this.list.length; i++) n += this.add(this.list[i]); return n; } },
  add: { value: function (x) { this.count++; return x + this.step; } },
  step: { get: function () { return this.kind & 1; } },
  open: { configurable: true, writable: true, value: function (x) { return "open" + x + this.kind; } },
  again: { configurable: true, value: function () { return "again" + this.kind; } },
});
function Heir(kind, name) { Base.call(this, kind); this.name = name; }
Heir.prototype = Object.create(Base.prototype, {
  add: { value: function (x) { this.count += 2; return x * 2; } },
  named: { value: function (prefix = "n") { return prefix + this.name + this.size(); } },
});
Heir.prototype.constructor = Heir;
function Sloppy(kind) { Base.call(this, kind); }
Sloppy.prototype = Object.create(Base.prototype);
// The name above is read-only: the store does nothing.
Sloppy.prototype.add = function (x) { return x + 1000; };
line("stored above a read-only name", Object.keys(Sloppy.prototype).join(), Sloppy.prototype.add === Base.prototype.add);
line("strict store above", attempt(() => Strict.size(Sloppy.prototype, function () { return -1; })));
Object.defineProperty(Sloppy.prototype, "total", { value: function () { return "total" + this.size(); }, configurable: true });
function Own(kind) { Base.call(this, kind); attempt(() => { this.add = x => x + 5000; }); Object.defineProperty(this, "open", { value: x => "own" + x, configurable: true }); }
Own.prototype = Object.create(Base.prototype);
const make = [k => new Base(k), k => new Heir(k, "h" + k), k => new Sloppy(k), k => new Own(k)];
function work(o) { return [o.size(), o.total(), o.add(3), attempt(() => o.open(1)), attempt(() => o.again()), attempt(() => o.named ? o.named() : "none"), o.count].join(); }
function sum(objects) { let n = 0; for (let k = 0; k < objects.length; k++) { const o = objects[k]; n += o.size() + o.add(k); } return n; }
for (let k = 0; k < 4; k++) for (const m of make) line(k, work(m(k)));
const many = Array.from({ length: 40 }, (_, i) => make[i & 3](i % 7));
for (let k = 0; k < 30; k++) line.last = sum(many);
line("sum", sum(many), calls);
const bases = Array.from({ length: 20 }, (_, i) => new Base(i % 5)), heirs = Array.from({ length: 20 }, (_, i) => new Heir(i % 5, "x"));
function sumOf(objects) { let n = 0; for (const o of objects) { n += o.total(); n += o.add(1); } return n; }
for (let k = 0; k < 30; k++) line.last = sumOf(bases) + sumOf(heirs);
line("typed", sumOf(bases), sumOf(heirs), calls);
// Stores into objects
const b = new Base(3);
b.add = 7;
line("sloppy store", b.add(1), Object.keys(b).join());
line("strict store", attempt(() => Strict.store(b, 8)), attempt(() => Strict.open(b, x => "stored" + x)), b.add(1));
Object.defineProperty(b, "add", { value: x => x + 70000, configurable: true });
line("own", b.add(1), b.total(), b.size());
delete b.add;
line("without it", b.add(1), b.total());
line("other receivers", attempt(() => Base.prototype.size.call({ kind: 2, ensure() { this.list = [1, 2, 3]; } })), attempt(() => Base.prototype.size.call(null)), attempt(() => Base.prototype.add.call(5, 1)));
line("through a proxy", work(new Proxy(new Base(2), { get(t, k, r) { calls++; return Reflect.get(t, k, r); } })), calls);
line("created", work(Object.create(new Base(2))), attempt(() => work(Object.create(Base.prototype))));
// Definitions
line("read-only", attempt(() => Object.defineProperty(Base.prototype, "add", { value: () => 1 }) && "defined"), attempt(() => delete Base.prototype.size), attempt(() => Strict.remove(Base.prototype)));
Object.defineProperty(Base.prototype, "again", { value: function () { return "second" + this.kind; }, configurable: true });
line("defined again", new Base(1).again(), new Heir(2, "a").again());
Object.defineProperty(Base.prototype, "again", { get() { return () => "got" + this.kind; }, configurable: true });
line("as an accessor", new Base(1).again(), new Heir(2, "a").again());
delete Base.prototype.again;
line("deleted", attempt(() => new Base(1).again()), attempt(() => new Heir(1, "b").again()), work(new Heir(1, "b")));
Base.prototype.open = function (x) { return "stored over" + x; };
line("stored over", new Base(1).open(4), new Heir(1, "c").open(5), new Own(1).open(6));
Object.setPrototypeOf(Heir.prototype, { ensure() { this.list = [9, 9]; }, size() { return 77; }, open: () => "other", again: () => "other again", total: () => "other total", step: 5 });
line("another parent", work(new Heir(3, "d")), heirs[3].size(), heirs[3].add(2));
Object.freeze(Base.prototype);
line("frozen", work(new Base(2)), sumOf(bases), attempt(() => Strict.store(Base.prototype, 1)));
console.log(lines.join("\n"));
