// A constructor function that Babel compiles out of a class constructs its parent, a class, with Reflect.construct. A class that a mixin returns extends a constructor function. The objects of both have one layout with the parent's fields.
function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }
function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }
function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }
function _callSuper(t, o, e) { o = _getPrototypeOf(o); var r = Reflect.construct(o, e || [], _getPrototypeOf(t).constructor); return r && ("object" == typeof r || "function" == typeof r) ? r : t; }
class Cursor {
    constructor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
    step() { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; }
    all() { let sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; }
    kind() { return "cursor"; }
    describe() { return this.kind() + Object.keys(this).join(); }
}
var Compiled = function (_Cursor) {
    function Compiled(text, mark) { var _this; _this = _callSuper(this, Compiled, [text]); _this.mark = mark; return _this; }
    _inherits(Compiled, _Cursor);
    Compiled.prototype.kind = function () { return "compiled" + this.mark; };
    return Compiled;
}(Cursor);
function Parser(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Parser.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Parser.prototype.all = function () { let sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Parser.prototype.kind = function () { return "parser"; };
Parser.prototype.describe = function () { return this.kind() + Object.keys(this).join(); };
const mixin = Base => class Mixed extends Base { constructor(text) { super(text); this.mark = 1; } kind() { return "mixed" + this.mark + super.kind(); } };
const Mixed = mixin(Parser);
const text = "alpha beta gamma delta ".repeat(4);
let sum = 0;
for (let i = 0; i < 3; i++) {
    const compiled = new Compiled(text, i), mixed = new Mixed(text);
    sum += compiled.all() + mixed.all();
    console.log(compiled.describe(), mixed.describe(), compiled instanceof Cursor, mixed instanceof Parser, compiled.constructor === Compiled, mixed.constructor === Mixed);
}
console.log(sum, new Cursor(text).all(), new Parser(text).all(), new Parser("x").describe(), new Cursor("x").describe());
// What is laid between later is found.
Compiled.prototype.step = function () { this.pos = this.text.length; return -1; };
Mixed.prototype.step = function () { this.pos = this.text.length; return -2; };
console.log(new Compiled(text, 7).all(), new Mixed(text).all(), new Cursor(text).all(), new Parser(text).all());
Object.defineProperty(Cursor.prototype, "value", { set(v) { this.seen = v; }, get() { return "got"; }, configurable: true });
const late = new Compiled("y", 8);
console.log(JSON.stringify(late), late.value, JSON.stringify(Reflect.construct(Cursor, ["z"], Parser)), Reflect.construct(Parser, ["z"], Cursor).describe());
