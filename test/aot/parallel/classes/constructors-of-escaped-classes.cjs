// A class that anybody may construct through: new.target is the class itself, a child, another function, a proxy; the prototype gains setters and read-only names.
"use strict";
const out = [];
const text = v => v === null ? "null" : typeof v === "object" ? "{" + Object.getOwnPropertyNames(v).map(k => k + ":" + (typeof v[k] === "object" ? "o" : String(v[k]))).join() + "}" : String(v);
const show = o => out.push(o instanceof Error ? o.constructor.name + " " + o.message : Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + "=" + ("value" in d ? text(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : ""); }).join(" ") + " | " + text(o.row) + text(o.place) + (o instanceof Seat) + (Object.getPrototypeOf(o) === Seat.prototype));
class Span { constructor(from, till) { this.till = till; this.from = from; } }
class Seat { constructor(a, b) { this.row = a; this.at = new Span(a, b); this.place = b; if (b > 2) this.extra = [a]; if (b === 4) return { row: "other", place: a }; if (b === 5) throw new TypeError("five"); } sum(n) { return n + 1; } }
class Ticket { constructor(desk) { this.span = new Span(desk.from, desk.till); this.from = desk.from; this.price = desk.price; this.hue = desk.hue; } }
globalThis.kept = [Seat, Span, Ticket];
const make = (C, ...l) => { try { return Reflect.construct(Seat, l, C); } catch (e) { return e; } };
function Old() {}
Old.prototype = { sum(n) { return "old" + n; } };
function None() {}
None.prototype = null;
class Child extends Seat { constructor(a, b) { super(a, b); this.child = b; } sum(n) { return "child" + n; } }
const byValue = [class extends Seat { own = 1; }][out.length];
for (let i = 0; i < 7; i++) {
  for (const C of [Seat, Old, None, Child, byValue]) show(make(C, i * 0.5, i));
  try { show(new Seat(i, i)); show(new Child(i, i)); show(new byValue("s", i)); } catch (e) { show(e); }
}
show(new (new Proxy(Seat, {}))(1, 2));
show(new (Seat.bind(null, 7))(1));
try { Seat(1, 2); } catch (e) { out.push(e.constructor.name); }
const desks = [{ hue: 1, price: "v", from: 0, till: 3 }, { get hue() { return "got"; }, from: 1 }, { hue: null, price: 1.5, from: "s", till: {} }];
for (let i = 0; i < 30; i++) { const t = new Ticket(desks[i % 3]); if (i < 6) out.push(text(t) + text(t.span) + (t instanceof Ticket)); }
try { new Ticket(null); } catch (e) { out.push(e.constructor.name); }
Object.defineProperty(Seat.prototype, "place", { set(v) { this.hidden = v; }, get() { return "got" + String(this.hidden); }, configurable: true });
for (let i = 0; i < 4; i++) show(new Seat(i, i));
delete Seat.prototype.place;
Object.defineProperty(Span.prototype, "till", { value: 9, writable: false, configurable: true });
try { show(new Seat(1, 1)); } catch (e) { out.push(e.constructor.name); }
delete Span.prototype.till;
Object.setPrototypeOf(Seat.prototype, { set row(v) { this.above = v; } });
for (let i = 0; i < 3; i++) show(new Seat(i, i));
Object.setPrototypeOf(Seat.prototype, Object.prototype);
for (let i = 0; i < 3; i++) show(new Seat(i, i));
for (const row of out) console.log(row);
