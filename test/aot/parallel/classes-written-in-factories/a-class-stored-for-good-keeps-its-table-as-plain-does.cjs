// STATISTIC: CapturesOfClassesStoredForGoodPromoted >= 10
"use strict";
const refs = [], out = [];
(function (exports) {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var Keeper0 = function Keeper0() { this.rows = table0.rows.length; };
  Keeper0.prototype.first = function () { return table0.rows[0] + this.rows; };
  exports.Keeper0 = Keeper0;
})(exports);
out.push(new exports.Keeper0().first());
(function (exports) {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var Keeper1 = function Keeper1() { this.rows = table1.rows.length; };
  Keeper1.prototype.first = function () { return table1.rows[0] + this.rows; };
  exports.Keeper1 = Keeper1;
})(exports);
out.push(new exports.Keeper1().first());
(function (exports) {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var Keeper2 = function Keeper2() { this.rows = table2.rows.length; };
  Keeper2.prototype.first = function () { return table2.rows[0] + this.rows; };
  exports.Keeper2 = Keeper2;
})(exports);
out.push(new exports.Keeper2().first());
(function (exports) {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var Keeper3 = function Keeper3() { this.rows = table3.rows.length; };
  Keeper3.prototype.first = function () { return table3.rows[0] + this.rows; };
  exports.Keeper3 = Keeper3;
})(exports);
out.push(new exports.Keeper3().first());
(function (exports) {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var Keeper4 = function Keeper4() { this.rows = table4.rows.length; };
  Keeper4.prototype.first = function () { return table4.rows[0] + this.rows; };
  exports.Keeper4 = Keeper4;
})(exports);
out.push(new exports.Keeper4().first());
(function (exports) {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var Keeper5 = function Keeper5() { this.rows = table5.rows.length; };
  Keeper5.prototype.first = function () { return table5.rows[0] + this.rows; };
  exports.Keeper5 = Keeper5;
})(exports);
out.push(new exports.Keeper5().first());
(function (exports) {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var Keeper6 = function Keeper6() { this.rows = table6.rows.length; };
  Keeper6.prototype.first = function () { return table6.rows[0] + this.rows; };
  exports.Keeper6 = Keeper6;
})(exports);
out.push(new exports.Keeper6().first());
(function (exports) {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var Keeper7 = function Keeper7() { this.rows = table7.rows.length; };
  Keeper7.prototype.first = function () { return table7.rows[0] + this.rows; };
  exports.Keeper7 = Keeper7;
})(exports);
out.push(new exports.Keeper7().first());
(function (exports) {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var Keeper8 = function Keeper8() { this.rows = table8.rows.length; };
  Keeper8.prototype.first = function () { return table8.rows[0] + this.rows; };
  exports.Keeper8 = Keeper8;
})(exports);
out.push(new exports.Keeper8().first());
(function (exports) {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Keeper9 = function Keeper9() { this.rows = table9.rows.length; };
  Keeper9.prototype.first = function () { return table9.rows[0] + this.rows; };
  exports.Keeper9 = Keeper9;
})(exports);
out.push(new exports.Keeper9().first());
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
