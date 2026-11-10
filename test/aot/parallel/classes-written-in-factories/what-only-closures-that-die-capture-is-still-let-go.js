// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const refs = [];
const out = [];
(function () {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var count = function () { return table0.rows.length + table0.rows[7]; };
  out.push(count());
})();
(function () {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var count = function () { return table1.rows.length + table1.rows[7]; };
  out.push(count());
})();
(function () {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var count = function () { return table2.rows.length + table2.rows[7]; };
  out.push(count());
})();
(function () {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var count = function () { return table3.rows.length + table3.rows[7]; };
  out.push(count());
})();
(function () {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var count = function () { return table4.rows.length + table4.rows[7]; };
  out.push(count());
})();
(function () {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var count = function () { return table5.rows.length + table5.rows[7]; };
  out.push(count());
})();
(function () {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var count = function () { return table6.rows.length + table6.rows[7]; };
  out.push(count());
})();
(function () {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var count = function () { return table7.rows.length + table7.rows[7]; };
  out.push(count());
})();
(function () {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var count = function () { return table8.rows.length + table8.rows[7]; };
  out.push(count());
})();
(function () {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var count = function () { return table9.rows.length + table9.rows[7]; };
  out.push(count());
})();
var kept;
(function () {
  var table = { rows: new Array(2000).fill(77) };
  refs.push(new WeakRef(table));
  var Keeper = function Keeper() { this.rows = table.rows.length; };
  Keeper.prototype.first = function () { return table.rows[0] + this.rows; };
  kept = Keeper;
})();
out.push(new kept().first());
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.slice(0, 10).filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + gone, refs[10].deref() !== undefined, new kept().first());
  }, 5);
}, 5);
