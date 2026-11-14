// Constructors that methods construct which loops call: plain, with heirs, with another new.target, with setters and locked fields above them, and with a throw.
"use strict";
const out = [];
class Position { constructor(line, column) { this.line = line; this.column = column; } }
class Location { constructor(start, end) { this.start = start; this.end = end; } }
class Base { constructor(v) { this.v = v; this.name = new.target.name; } }
class Heir extends Base { constructor(v) { super(v + 1); this.w = v; } }
class Thrower { constructor(v) { if (v === 3) throw new RangeError("three"); this.v = v; } }
class Scanner {
  constructor(text) { this.text = text; this.pos = this.start = 0; this.line = 1; this.tokens = []; }
  at() { return new Position(this.line, this.pos - this.start); }
  location(start) { return new Location(start, this.at()); }
  bases() { return [new Base(this.pos), new Heir(this.pos)]; }
  thrower() { try { return new Thrower(this.pos).v; } catch (e) { return e.message; } }
  other() { return Reflect.construct(Position, [this.pos, 1], Location); }
  next() {
    const start = this.at();
    if (this.text[this.pos++] === "\n") { this.line++; this.start = this.pos; }
    const [base, heir] = this.bases(), other = this.other();
    this.tokens.push(this.location(start), base, heir, this.thrower(), other);
  }
  run() { while (this.pos < this.text.length) this.next(); return this.tokens; }
}
const show = (tokens) => JSON.stringify(tokens) + tokens.map((t) => (typeof t === "object" ? t.constructor.name + Object.keys(t) : t)).join();
globalThis.kept = [Position, Location, Base, Heir, Scanner];
out.push(show(new Scanner("ab\ncd").run()));
Object.defineProperty(Position.prototype, "line", { set(v) { Object.defineProperty(this, "set", { value: v, enumerable: true }); }, get() { return -1; }, configurable: true });
out.push(show(new Scanner("ab\ncd").run()));
delete Position.prototype.line;
Object.defineProperty(Location.prototype, "end", { value: 1, writable: false, configurable: true });
try { out.push(show(new Scanner("a").run())); } catch (e) { out.push(e.constructor.name); }
delete Location.prototype.end;
Object.setPrototypeOf(Position.prototype, { inherited: 5 });
out.push(show(new Scanner("a\n").run()) + new Scanner("").at().inherited);
for (const line of out) console.log(line);
