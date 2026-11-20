// Constructors that methods construct which loops call: plain, with heirs, with another new.target, with setters and locked fields above them, and with a throw.
"use strict";
const out = [];
class Spot { constructor(row, place) { this.place = place; this.row = row; } }
class Stretch { constructor(from, till) { this.till = till; this.from = from; } }
class Base { constructor(v) { this.v = v; this.name = new.target.name; } }
class Heir extends Base { constructor(v) { super(v + 1); this.w = v; } }
class Thrower { constructor(v) { if (v === 3) throw new RangeError("three"); this.v = v; } }
class Walker {
  constructor(path) { this.finds = []; this.row = 1; this.path = path; this.left = this.at = 0; }
  spot() { return new Spot(this.row, this.at - this.left); }
  stretch(from) { return new Stretch(from, this.spot()); }
  bases() { return [new Base(this.at), new Heir(this.at)]; }
  thrower() { try { return new Thrower(this.at).v; } catch (e) { return e.message; } }
  other() { return Reflect.construct(Spot, [this.at, 1], Stretch); }
  next() {
    const from = this.spot();
    if (this.path[this.at++] === "\n") { this.left = this.at; this.row++; }
    const [base, heir] = this.bases(), other = this.other();
    this.finds.push(this.stretch(from), base, heir, this.thrower(), other);
  }
  run() { while (this.at < this.path.length) this.next(); return this.finds; }
}
const show = (finds) => JSON.stringify(finds) + finds.map((t) => (typeof t === "object" ? t.constructor.name + Object.keys(t) : t)).join();
globalThis.kept = [Spot, Stretch, Base, Heir, Walker];
out.push(show(new Walker("ab\ncd").run()));
Object.defineProperty(Spot.prototype, "row", { set(v) { Object.defineProperty(this, "set", { value: v, enumerable: true }); }, get() { return -1; }, configurable: true });
out.push(show(new Walker("ab\ncd").run()));
delete Spot.prototype.row;
Object.defineProperty(Stretch.prototype, "till", { value: 1, writable: false, configurable: true });
try { out.push(show(new Walker("a").run())); } catch (e) { out.push(e.constructor.name); }
delete Stretch.prototype.till;
Object.setPrototypeOf(Spot.prototype, { inherited: 5 });
out.push(show(new Walker("a\n").run()) + new Walker("").spot().inherited);
for (const line of out) console.log(line);
