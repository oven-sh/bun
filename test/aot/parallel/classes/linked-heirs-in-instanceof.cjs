// `x instanceof Heir` reads the own prototype of a constructor function that is linked below its parent: nothing of either is shown to anybody.
// STATISTIC: ClosedPrototypeObjects >= 2
"use strict";
var __extends = (function () {
    var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; }; return extendStatics(d, b); };
    return function (d, b) { if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null"); extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); };
})();
function Cursor(text) { this.text = text; this.pos = 0; this.start = 0; this.value = null; }
Cursor.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.value = this.pos - this.start; this.pos++; return this.value; };
Cursor.prototype.all = function () { var sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
var Heir = (function (_super) {
    __extends(Heir, _super);
    function Heir(text) { var _this = _super.call(this, text) || this; _this.extra = 1; return _this; }
    Heir.prototype.more = function () { return this.extra + this.pos; };
    return Heir;
}(Cursor));
function isHeir(x) { return x instanceof Heir; }
var text = "alpha beta gamma delta ".repeat(4), sum = 0;
for (var i = 0; i < 300; i++) { var heir = new Heir(text); sum += heir.all() + heir.more(); }
console.log(sum, isHeir(heir), isHeir(new Cursor("a")), isHeir({}), isHeir(null), Object.keys(heir).join());
