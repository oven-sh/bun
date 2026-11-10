// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const refs = [], out = [];
const wants = JSON.parse("false");
(function (exports) {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var Keeper0 = function Keeper0() { this.rows = table0.rows.length; };
  out.push(new Keeper0().rows);
  if (wants) exports.Keeper0 = Keeper0;
})(exports);
(function (exports) {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var Keeper1 = function Keeper1() { this.rows = table1.rows.length; };
  out.push(new Keeper1().rows);
  if (wants) exports.Keeper1 = Keeper1;
})(exports);
(function (exports) {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var Keeper2 = function Keeper2() { this.rows = table2.rows.length; };
  out.push(new Keeper2().rows);
  if (wants) exports.Keeper2 = Keeper2;
})(exports);
(function (exports) {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var Keeper3 = function Keeper3() { this.rows = table3.rows.length; };
  out.push(new Keeper3().rows);
  if (wants) exports.Keeper3 = Keeper3;
})(exports);
(function (exports) {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var Keeper4 = function Keeper4() { this.rows = table4.rows.length; };
  out.push(new Keeper4().rows);
  if (wants) exports.Keeper4 = Keeper4;
})(exports);
(function (exports) {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var Keeper5 = function Keeper5() { this.rows = table5.rows.length; };
  out.push(new Keeper5().rows);
  if (wants) exports.Keeper5 = Keeper5;
})(exports);
(function (exports) {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var Keeper6 = function Keeper6() { this.rows = table6.rows.length; };
  out.push(new Keeper6().rows);
  if (wants) exports.Keeper6 = Keeper6;
})(exports);
(function (exports) {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var Keeper7 = function Keeper7() { this.rows = table7.rows.length; };
  out.push(new Keeper7().rows);
  if (wants) exports.Keeper7 = Keeper7;
})(exports);
(function (exports) {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var Keeper8 = function Keeper8() { this.rows = table8.rows.length; };
  out.push(new Keeper8().rows);
  if (wants) exports.Keeper8 = Keeper8;
})(exports);
(function (exports) {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Keeper9 = function Keeper9() { this.rows = table9.rows.length; };
  out.push(new Keeper9().rows);
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
