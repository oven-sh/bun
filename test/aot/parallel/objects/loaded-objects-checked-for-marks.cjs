// Objects that a method fills are read off the field of another object: the check of their class answers for their fields, for freezing and for their prototype, whatever became of the object between two reads.
// STATISTIC: LoadedObjectsCheckedForMarks >= 4
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
function Cursor() {}
Cursor.prototype.init = function init(n) { this.pos = n; this.end = n; this.line = 1; this.type = "start"; this.at = null; };
Cursor.prototype.place = function place() { return { line: this.line, column: this.pos - this.end }; };
Cursor.prototype.total = function total() { return this.pos + this.end + this.line; };
function Holder(cursor) { this.cursor = cursor; this.seen = 0; }
Holder.prototype.finish = function finish(type, value) { this.cursor.end = this.cursor.pos; this.cursor.at = this.cursor.place(); const before = this.cursor.type; this.cursor.type = type; this.cursor.line = value; this.seen++; return before + this.cursor.end + this.cursor.at.column; };
Holder.prototype.step = function step(k) { for (let i = 0; i < k; i++) { this.cursor.pos += 2; this.cursor.line += 1; this.seen += this.cursor.total(); } return this.seen; };
Holder.prototype.both = function both(other) { this.cursor.pos = other.cursor.pos + 1; other.cursor.end = this.cursor.pos; return this.cursor.total() + other.cursor.total(); };
function begin(n) { const cursor = new Cursor(); cursor.init(n); return cursor; }
globalThis.seenOutside = { Holder, Cursor, holder: new Holder(begin(1)), change(holder) { return holder; } };
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`(Cursor) => ({
  nothing(c) { return c; }, deleted(c) { del§ete c.pos; return c; }, deletedLast(c) { del§ete c.at; return c; }, frozen(c) { return Ob§ject.freeze(c); }, sealed(c) { return Ob§ject.seal(c); }, closed(c) { return Ob§ject.preventExtensions(c); },
  locked(c) { return Ob§ject.defineProperty(c, "end", { writable: false }); }, accessor(c) { let held = 5; return Ob§ject.defineProperty(c, "pos", { get() { return held; }, set(v) { held = v + 100; }, configurable: true, enumerable: true }); },
  otherPrototype(c) { return Ob§ject.setPrototypeOf(c, { place() { return { line: 0, column: 77 }; }, total() { return 1000; } }); }, noPrototype(c) { return Ob§ject.setPrototypeOf(c, null); },
  half(c) { const h = new Cursor(); h.pos = 1; h.end = 2; h.line = 3; return h; }, empty(c) { return new Cursor(); },
  copied(c) { const d = new Cursor(); for (const key of Ob§ject.keys(c).reverse()) d[key] = c[key]; return d; }, assigned(c) { return Ob§ject.assign(new Cursor(), c); }, record(c) { return { pos: 1, end: 2, line: 3, type: "r", at: null, place() { return { column: 9 }; }, total() { return 6; } }; },
  missing() { return undefined; }, number() { return 5; }, proxied(c) { return new Proxy(c, { get(target, key) { return key === "line" ? 40 : target[key]; } }); }, created(c) { return Ob§ject.create(c); },
})`.split("§").join(globalThis.nothing ?? ""))(Cursor);
for (const [name, fate] of Object.entries(fates)) {
  const plain = new Holder(begin(3));
  for (let round = 0; round < 3; round++) {
    const cursor = begin(round);
    const holder = globalThis.seenOutside.change(new Holder(cursor));
    out.push([name, round, show(() => holder.finish("a", 2)), show(() => holder.step(3)), show(() => holder.both(plain))].join(" "));
    if (round !== 1) continue;
    const changed = fate(cursor);
    const other = globalThis.seenOutside.change(new Holder(changed));
    out.push([show(() => other.finish("b", 5)), show(() => other.step(2)), show(() => other.both(plain)), show(() => plain.both(other)), show(() => Object.keys(changed).join()), show(() => other.finish("c", 6)), show(() => other.step(1))].join(" "));
  }
}
// Methods of the class are replaced while a loop runs.
{
  const holder = globalThis.seenOutside.change(new Holder(begin(1)));
  out.push(holder.step(2));
  Cursor.prototype.total = function () { return 1; };
  out.push(holder.step(2));
  Cursor.prototype.place = function () { return { column: 3 }; };
  out.push(show(() => holder.finish("d", 9)) + show(() => holder.step(2)) + Object.keys(holder.cursor));
}
for (const line of out) console.log(line);
