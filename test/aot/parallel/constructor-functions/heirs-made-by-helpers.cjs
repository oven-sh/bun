// A helper makes the heirs (Backbone's extend): their constructors are no classes of the program. Their objects are laid out as the parent's; what their prototypes hide is asked of each object.
// COUNTER: InstanceTemplatesCached >= 1
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Cursor(text) { this.text = text; this.pos = 0; this.kind = "eof"; }
Cursor.prototype.step = function () { const first = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.pos++; this.kind = this.name(); return this.pos - first; };
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.step(); return n; };
Cursor.prototype.name = function () { return "cursor"; };
Cursor.extend = function (methods, statics) {
  const parent = this; let child;
  if (methods && Object.prototype.hasOwnProperty.call(methods, "constructor")) child = methods.constructor;
  else child = function () { return parent.apply(this, arguments); };
  Object.assign(child, parent, statics); child.prototype = Object.assign(Object.create(parent.prototype), methods); child.prototype.constructor = child; child.__super__ = parent.prototype;
  return child;
};
const Named = Cursor.extend({ name() { return "named" + this.pos; }, more() { return this.pos; } });
const Deep = Named.extend({ step() { this.pos += 2; return 2; } });
const Same = Cursor.extend({});
const Other = Cursor.extend({ constructor: function (t) { Cursor.call(this, t); this.extra = 2; }, more() { return this.extra; } }, { count: 1 });
const classes = [Cursor, Named, Deep, Same, Other], text = "alpha beta gamma delta ";
let total = 0;
for (let i = 0; i < 200; i++) for (const C of classes) { const o = new C(text + i); total += o.all() + o.kind.length; }
out.push(total);
const look = (C) => { const o = new C("a bc"); out.push(o.all(), o.name(), show(() => o.more()), JSON.stringify(o), Object.keys(o).join(), o instanceof Cursor, o instanceof Named, o.constructor === C, Object.getPrototypeOf(o) === C.prototype); };
classes.forEach(look);
// What the heirs' prototypes hide changes: hidden names go, others come, as values, methods, accessors; parents move.
delete Named.prototype.name; classes.forEach(look);
Named.prototype.name = () => "again"; Deep.prototype.name = function () { return "deep" + this.kind; }; classes.forEach(look);
Cursor.prototype.step = function () { this.pos += 3; return 1; }; classes.forEach(look);
Same.prototype.step = function () { this.pos += 4; return 9; }; classes.forEach(look);
Object.defineProperty(Same.prototype, "kind", { set(v) { out.push("set" + v); }, get() { return "got"; }, configurable: true }); classes.forEach(look); delete Same.prototype.kind;
Object.defineProperty(Deep.prototype, "pos", { value: 1, writable: false, configurable: true }); out.push(show(() => look(Deep))); delete Deep.prototype.pos; look(Deep);
Object.setPrototypeOf(Deep.prototype, { name() { return "moved"; }, all() { return this.text; } }); look(Deep); look(Named);
Cursor.prototype = { all() { return 1; }, name() { return "new"; } }; out.push(show(() => new Cursor("x").all()), new Cursor("y").name()); look(Named); look(Same);
const late = new Named("l"); Object.freeze(late); out.push(show(() => late.all())); const odd = new Same("o"); odd.name = () => "own"; odd.late = 1; delete odd.kind; out.push(show(() => odd.all()), odd.name(), JSON.stringify(odd));
for (const line of out) console.log(String(line));
