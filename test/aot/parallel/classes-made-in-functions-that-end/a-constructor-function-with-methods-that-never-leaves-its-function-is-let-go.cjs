"use strict";
const refs = [], out = [];
const wants = JSON.parse("false");
(function (exports) {
  function size0() { return table0.rows.length; }
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var Keeper0 = function Keeper0() { this.rows = size0(); };
  Keeper0.prototype.first = function () { return table0.rows[0] + this.rows; };
  out.push(new Keeper0().first());
  if (wants) exports.Keeper0 = Keeper0;
})(exports);
(function (exports) {
  function size1() { return table1.rows.length; }
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var Keeper1 = function Keeper1() { this.rows = size1(); };
  Keeper1.prototype.first = function () { return table1.rows[0] + this.rows; };
  out.push(new Keeper1().first());
  if (wants) exports.Keeper1 = Keeper1;
})(exports);
(function (exports) {
  function size2() { return table2.rows.length; }
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var Keeper2 = function Keeper2() { this.rows = size2(); };
  Keeper2.prototype.first = function () { return table2.rows[0] + this.rows; };
  out.push(new Keeper2().first());
  if (wants) exports.Keeper2 = Keeper2;
})(exports);
(function (exports) {
  function size3() { return table3.rows.length; }
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var Keeper3 = function Keeper3() { this.rows = size3(); };
  Keeper3.prototype.first = function () { return table3.rows[0] + this.rows; };
  out.push(new Keeper3().first());
  if (wants) exports.Keeper3 = Keeper3;
})(exports);
(function (exports) {
  function size4() { return table4.rows.length; }
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var Keeper4 = function Keeper4() { this.rows = size4(); };
  Keeper4.prototype.first = function () { return table4.rows[0] + this.rows; };
  out.push(new Keeper4().first());
  if (wants) exports.Keeper4 = Keeper4;
})(exports);
(function (exports) {
  function size5() { return table5.rows.length; }
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var Keeper5 = function Keeper5() { this.rows = size5(); };
  Keeper5.prototype.first = function () { return table5.rows[0] + this.rows; };
  out.push(new Keeper5().first());
  if (wants) exports.Keeper5 = Keeper5;
})(exports);
(function (exports) {
  function size6() { return table6.rows.length; }
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var Keeper6 = function Keeper6() { this.rows = size6(); };
  Keeper6.prototype.first = function () { return table6.rows[0] + this.rows; };
  out.push(new Keeper6().first());
  if (wants) exports.Keeper6 = Keeper6;
})(exports);
(function (exports) {
  function size7() { return table7.rows.length; }
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var Keeper7 = function Keeper7() { this.rows = size7(); };
  Keeper7.prototype.first = function () { return table7.rows[0] + this.rows; };
  out.push(new Keeper7().first());
  if (wants) exports.Keeper7 = Keeper7;
})(exports);
(function (exports) {
  function size8() { return table8.rows.length; }
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var Keeper8 = function Keeper8() { this.rows = size8(); };
  Keeper8.prototype.first = function () { return table8.rows[0] + this.rows; };
  out.push(new Keeper8().first());
  if (wants) exports.Keeper8 = Keeper8;
})(exports);
(function (exports) {
  function size9() { return table9.rows.length; }
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Keeper9 = function Keeper9() { this.rows = size9(); };
  Keeper9.prototype.first = function () { return table9.rows[0] + this.rows; };
  out.push(new Keeper9().first());
  if (wants) exports.Keeper9 = Keeper9;
})(exports);
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
