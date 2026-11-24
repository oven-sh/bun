"use strict";
const any = globalThis;
const tag = String(any.nothing ?? "t");
function Base() { this.kind = "base"; }
Base.prototype.tell = function () { return "base " + this.kind; };
const lay = function (sub, above) {
  sub.prototype = Object.create(above && above.prototype, { constructor: { value: sub, writable: true, configurable: true } });
  Object.defineProperty(sub, "prototype", { writable: false });
  Object.setPrototypeOf(sub, above);
  return Object.defineProperty(sub, "prototype", { writable: false });
};
const Mid = lay(function Mid() { const self = Reflect.construct(Base, [], new.target || Base); self.kind = tag; return self; }, Base);
function Third() { return Reflect.construct(Mid, [], Third); }
Third.prototype = Object.create(Mid.prototype);
Object.setPrototypeOf(Third, Mid);
const found = [];
const made = Reflect.construct(Mid, [], Third);
found.push(made instanceof Third, Mid.prototype.isPrototypeOf(made), made.tell());
class Last extends Mid { tell() { return "last " + super.tell(); } }
exports.said = found.join(",") + " " + new Last().tell();
