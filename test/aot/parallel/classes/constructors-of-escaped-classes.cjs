// A class that anybody may construct through: new.target is the class itself, a child, another function, a proxy; the prototype gains setters and read-only names.
"use strict";
const out = [];
const text = v => v === null ? "null" : typeof v === "object" ? "{" + Object.getOwnPropertyNames(v).map(k => k + ":" + (typeof v[k] === "object" ? "o" : String(v[k]))).join() + "}" : String(v);
const show = o => out.push(o instanceof Error ? o.constructor.name + " " + o.message : Object.getOwnPropertyNames(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return k + "=" + ("value" in d ? text(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : ""); }).join(" ") + " | " + text(o.line) + text(o.column) + (o instanceof Point) + (Object.getPrototypeOf(o) === Point.prototype));
class Place { constructor(start, end) { this.start = start; this.end = end; } }
class Point { constructor(a, b) { this.line = a; this.at = new Place(a, b); this.column = b; if (b > 2) this.extra = [a]; if (b === 4) return { line: "other", column: a }; if (b === 5) throw new TypeError("five"); } sum(n) { return n + 1; } }
class Token { constructor(state) { this.type = state.type; this.value = state.value; this.start = state.start; this.loc = new Place(state.start, state.end); } }
globalThis.kept = [Point, Place, Token];
const make = (C, ...l) => { try { return Reflect.construct(Point, l, C); } catch (e) { return e; } };
function Old() {}
Old.prototype = { sum(n) { return "old" + n; } };
function None() {}
None.prototype = null;
class Child extends Point { constructor(a, b) { super(a, b); this.child = b; } sum(n) { return "child" + n; } }
const byValue = [class extends Point { own = 1; }][out.length];
for (let i = 0; i < 7; i++) {
  for (const C of [Point, Old, None, Child, byValue]) show(make(C, i * 0.5, i));
  try { show(new Point(i, i)); show(new Child(i, i)); show(new byValue("s", i)); } catch (e) { show(e); }
}
show(new (new Proxy(Point, {}))(1, 2));
show(new (Point.bind(null, 7))(1));
try { Point(1, 2); } catch (e) { out.push(e.constructor.name); }
const states = [{ type: 1, value: "v", start: 0, end: 3 }, { get type() { return "got"; }, start: 1 }, { type: null, value: 1.5, start: "s", end: {} }];
for (let i = 0; i < 30; i++) { const t = new Token(states[i % 3]); if (i < 6) out.push(text(t) + text(t.loc) + (t instanceof Token)); }
try { new Token(null); } catch (e) { out.push(e.constructor.name); }
Object.defineProperty(Point.prototype, "column", { set(v) { this.hidden = v; }, get() { return "got" + String(this.hidden); }, configurable: true });
for (let i = 0; i < 4; i++) show(new Point(i, i));
delete Point.prototype.column;
Object.defineProperty(Place.prototype, "end", { value: 9, writable: false, configurable: true });
try { show(new Point(1, 1)); } catch (e) { out.push(e.constructor.name); }
delete Place.prototype.end;
Object.setPrototypeOf(Point.prototype, { set line(v) { this.above = v; } });
for (let i = 0; i < 3; i++) show(new Point(i, i));
Object.setPrototypeOf(Point.prototype, Object.prototype);
for (let i = 0; i < 3; i++) show(new Point(i, i));
for (const line of out) console.log(line);
