// Mixins are classes over a parameter that every call fills with one constructor function: the class lists that function's fields.
// COUNTER: DynamicSubclassInstances <= 0
"use strict";
const out = [];
function Cursor(text) { this.text = text; this.pos = 0; this.end = null; }
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.text.charCodeAt(this.pos++); return n; };
Cursor.prototype.kind = function () { return "cursor"; };
const fields = (Base) => class Fields extends Base { a = 1; b = [2]; sum() { return this.a + this.b.length + this.pos; } };
function methods(Base) { return class extends Base { constructor(text, more) { super(text); this.more = more; } kind() { return "more " + super.kind(); } get twice() { return this.more * 2; } }; }
const nothing = function (Base) { class Nothing extends Base {} return Nothing; };
const Fields = fields(Cursor), Methods = methods(Cursor), Nothing = nothing(Cursor);
for (const Heir of [Fields, Methods, Nothing]) {
  let total = 0;
  for (let i = 0; i < 60; i++) { const h = new Heir("a" + i, i); total += h.all(); }
  const h = new Heir("xyz", 4);
  out.push(total, JSON.stringify(h), h.all(), h.kind(), h.twice, h.sum ? h.sum() : 0, Object.keys(h).join(), h instanceof Cursor, h instanceof Heir, Object.getPrototypeOf(Heir.prototype) === Cursor.prototype);
  h.end = "e"; h.pos = -0; h.extra = 1; delete h.text;
  out.push(JSON.stringify(h), "text" in h, Object.keys(h).join());
}
class Below extends Fields { c = 3; sum() { return super.sum() * this.c; } }
const below = new Below("pq"); below.all(); out.push(below.sum(), JSON.stringify(below), below.kind());
for (const line of out) console.log(String(line));
