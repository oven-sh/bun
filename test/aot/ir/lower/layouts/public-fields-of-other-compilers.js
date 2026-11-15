// RUN: link
// `_defineProperty(this, "x", 1)` as a statement of a constructor or of a constructor function: what the helper of Babel and of swc defines is a field. A helper that calls another function and a call under a condition are none.
// CHECK: layout {{*}}name="Point" {{*}}key="x" declared={type=anything} flags=[IsRequired]}, {key="y" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Named" {{*}}key="z" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Dog" {{*}}key="years" declared={type=anything} flags=[IsRequired]}

// RUN(NONE): link
// NONE-NOT: layout {{*}}name="Other" {{*}}key="x"
// NONE-NOT: layout {{*}}name="Under" {{*}}key="x"

"use strict";
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _define_property(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  } else obj[key] = value;
  return obj;
}
function other(e, r, t) { return (r = changed(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: !0, configurable: !0, writable: !0 }) : e[r] = t, e; }
function changed(name) { return name + "!"; }
export class Point {
  constructor() {
    _defineProperty(this, "x", 1);
    _defineProperty(this, "y", void 0);
  }
}
export class Named extends Point {
  constructor() {
    super(...arguments);
    _define_property(this, "z", this.x);
  }
}
export function Dog(years) {
  _defineProperty(this, "years", years);
}
Dog.prototype.age = function () { return this.years; };
export class Other {
  constructor() {
    other(this, "x", 1);
  }
}
export function Under(defines) {
  if (defines) _defineProperty(this, "x", 1);
  this.y = defines;
}
export const points = [new Point(), new Named(), new Dog(3), new Other(), new Under(true)];
