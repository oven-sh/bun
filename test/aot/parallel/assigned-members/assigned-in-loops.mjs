// STATISTIC: AssignedMemberChecks >= 9
// Names that statements put on the prototype of a class, declared by the class or not.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e.name}: ${e.message}`; } console.log(label, r); };
class Plain { k = 2; }
Plain.prototype.add = function (n) { return n + this.k; };
const plain = new Plain();
show("assigned", () => { let s = 0; for (let i = 0; i < 200; i++) s += plain.add(i & 3); return s; });

class Copied { k = 3; }
Object.assign(Copied.prototype, { scaled(n) { return n * this.k; } });
const copied = new Copied();
show("copied", () => { let s = 0; for (let i = 0; i < 200; i++) s += copied.scaled(i & 3); return s; });

class Replaced { k = 4; value(n) { return n; } }
show("before", () => { let s = 0; const a = new Replaced(); for (let i = 0; i < 200; i++) s += a.value(i & 3); return s; });
Replaced.prototype.value = function (n) { return n - this.k; };
const replaced = new Replaced();
show("replaced", () => { let s = 0; for (let i = 0; i < 200; i++) s += replaced.value(i & 3); return s; });

class Twice { k = 5; both(n) { return n; } }
Twice.prototype.both = function (n) { return n * 2; };
Twice.prototype.both = function (n) { return n * 3 + this.k; };
const twice = new Twice();
show("twice", () => { let s = 0; for (let i = 0; i < 200; i++) s += twice.both(i & 3); return s; });

class Maybe { k = 6; often(n) { return n + 1; } }
if (process.argv.length > 100) Maybe.prototype.often = function (n) { return n + 100; };
const maybe = new Maybe();
show("not replaced", () => { let s = 0; for (let i = 0; i < 200; i++) s += maybe.often(i & 3); return s; });

class Base { k = 7; shared(n) { return n; } }
class Heir extends Base { w = 1; }
class Other extends Base { shared(n) { return n * 1000; } }
Base.prototype.shared = function (n) { return n + this.k; };
const heir = new Heir();
const other = new Other();
show("heir", () => { let s = 0; for (let i = 0; i < 200; i++) s += heir.shared(i & 3); return s; });
show("heir that declares", () => { let s = 0; for (let i = 0; i < 200; i++) s += other.shared(i & 3); return s; });
Heir.prototype.shared = function (n) { return n - 1; };
show("heir assigned", () => { let s = 0; for (let i = 0; i < 200; i++) s += heir.shared(i & 3); return s; });

class Measured { w = 8; }
Object.defineProperty(Measured.prototype, "width", { get() { return this.w * 2; }, set(v) { this.w = v; }, configurable: true });
const measured = new Measured();
show("accessors", () => { let s = 0; for (let i = 0; i < 200; i++) { measured.width = i; s += measured.width; } return s; });

class Doubled { w = 9; get half() { return this.w; } set half(v) { this.w = v; } }
Object.defineProperty(Doubled.prototype, "half", { get() { return this.w + 1; } });
const doubled = new Doubled();
show("getter over a pair", () => { let s = 0; for (let i = 0; i < 200; i++) { doubled.half = i; s += doubled.half; } return s; });

class Listed { k = 10; }
Object.defineProperties(Listed.prototype, { first: { get() { return this.k; } }, second: { value: function (n) { return n + this.k; } } });
const listed = new Listed();
show("descriptors", () => { let s = 0; for (let i = 0; i < 200; i++) s += listed.first + listed.second(i & 3); return s; });
show("no setter", () => { "use strict"; for (let i = 0; i < 200; i++) listed.first = i; return listed.k; });
