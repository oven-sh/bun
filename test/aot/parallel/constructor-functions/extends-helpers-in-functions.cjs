// TypeScript's helper for heirs in a function: a UMD factory, a module of a bundle, a mixin.
// COUNTER: operationAOTFillSiteAnswers <= 10
"use strict";
const out = [];
(function (factory) { const module = { exports: {} }; factory(require, module.exports); out.push(...module.exports.lines); })(function (require, exports) {
  var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; }; return extendStatics(d, b); };
    return function (d, b) { if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null"); extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); };
  })();
  var Cursor = /** @class */ (function () { function Cursor(text) { this.text = text; this.pos = 0; this.last = null; } Cursor.prototype.all = function () { var n = 0; while (this.pos < this.text.length) n += this.text.charCodeAt(this.pos++); return n; }; Cursor.make = function (t) { return new this(t); }; return Cursor; }());
  var Heir = /** @class */ (function (_super) { __extends(Heir, _super); function Heir(text) { var _this = _super.call(this, text) || this; _this.extra = 1; return _this; } Heir.prototype.more = function () { return this.extra + this.pos; }; return Heir; }(Cursor));
  var Second = /** @class */ (function (_super) { __extends(Second, _super); function Second() { return _super !== null && _super.apply(this, arguments) || this; } Second.prototype.all = function () { return _super.prototype.all.call(this) * 2; }; return Second; }(Heir));
  var lines = []; var total = 0;
  for (var i = 0; i < 50; i++) { var h = new Heir("ab" + i), s = new Second("c" + i); total += h.all() + h.more() + s.all() + s.more(); }
  for (var _i = 0, _a = [Heir, Second]; _i < _a.length; _i++) { var C = _a[_i], o = new C("xy"); lines.push(JSON.stringify(o), o.all(), o.more(), Object.keys(o).join(), o instanceof Cursor, o instanceof Heir, o.constructor === C, C.make === Cursor.make, JSON.stringify(C.make("z"))); delete o.last; o.last = 1; o.late = 2; lines.push(Object.keys(o).join()); }
  exports.lines = [total].concat(lines);
});
// The receiver has a helper of its own: it runs.
const calls = [];
const given = function () { var __extends = (this && this.__extends) || (function () { return function (d, b) { throw new Error("not this one"); }; })(); var Base = (function () { function Base() { this.a = 1; } Base.prototype.up = function () { return ++this.a; }; return Base; }()); var Heir = (function (_super) { __extends(Heir, _super); function Heir() { var _this = _super.call(this) || this; _this.b = 2; return _this; } return Heir; }(Base)); return Heir; };
const Given = given.call({ __extends(d, b) { calls.push(d.name + b.name); Object.setPrototypeOf(d, b); d.prototype = Object.create(b.prototype, { constructor: { value: d }, own: { value: 5 } }); } });
const g = new Given(); g.up(); out.push(calls.join(), JSON.stringify(g), g.own, g.up(), Object.getPrototypeOf(Given).name);
const Odd = given.call({ __extends(d, b) { calls.push("odd"); } }); const odd = new Odd(); out.push(JSON.stringify(odd), typeof odd.up, calls.join());
let thrown = ""; try { given.call({}); } catch (error) { thrown = error.message; } out.push(thrown);
for (const line of out) console.log(String(line));
