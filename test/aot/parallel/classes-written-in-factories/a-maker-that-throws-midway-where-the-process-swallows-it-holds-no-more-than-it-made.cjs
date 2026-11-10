// STATISTIC: CapturesOfClassesStoredForGoodPromoted >= 10
"use strict";
const refs = [], out = [];
const trips = JSON.parse("true");
process.on("uncaughtException", error => { out.push("caught " + error.message); });
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const alive = refs.filter(ref => ref.deref() !== undefined).length;
    console.log(out.join(), refs.length, "alive:", alive <= 10 ? "no more than were made" : alive);
  }, 5);
}, 60);
(function (exports) {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Keeper = function Keeper() { this.rows = table0.rows.length + table1.rows.length + table2.rows.length + table3.rows.length + table4.rows.length + table5.rows.length + table6.rows.length + table7.rows.length + table8.rows.length + table9.rows.length; };
  Keeper.prototype.first = function () { return table0.rows[0] + this.rows; };
  if (trips) throw new Error("midway");
  exports.Keeper = Keeper;
})(exports);
