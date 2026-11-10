// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const refs = [], out = [];
const wants = JSON.parse("false");
(function () {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var Keeper0 = function Keeper0() { this.rows = table0.rows.length; };
  if (wants) out.push(new Keeper0().rows);
  out.push(table0.rows[7]);
})();
(function () {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var Keeper1 = function Keeper1() { this.rows = table1.rows.length; };
  if (wants) out.push(new Keeper1().rows);
  out.push(table1.rows[7]);
})();
(function () {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var Keeper2 = function Keeper2() { this.rows = table2.rows.length; };
  if (wants) out.push(new Keeper2().rows);
  out.push(table2.rows[7]);
})();
(function () {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var Keeper3 = function Keeper3() { this.rows = table3.rows.length; };
  if (wants) out.push(new Keeper3().rows);
  out.push(table3.rows[7]);
})();
(function () {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var Keeper4 = function Keeper4() { this.rows = table4.rows.length; };
  if (wants) out.push(new Keeper4().rows);
  out.push(table4.rows[7]);
})();
(function () {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var Keeper5 = function Keeper5() { this.rows = table5.rows.length; };
  if (wants) out.push(new Keeper5().rows);
  out.push(table5.rows[7]);
})();
(function () {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var Keeper6 = function Keeper6() { this.rows = table6.rows.length; };
  if (wants) out.push(new Keeper6().rows);
  out.push(table6.rows[7]);
})();
(function () {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var Keeper7 = function Keeper7() { this.rows = table7.rows.length; };
  if (wants) out.push(new Keeper7().rows);
  out.push(table7.rows[7]);
})();
(function () {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var Keeper8 = function Keeper8() { this.rows = table8.rows.length; };
  if (wants) out.push(new Keeper8().rows);
  out.push(table8.rows[7]);
})();
(function () {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Keeper9 = function Keeper9() { this.rows = table9.rows.length; };
  if (wants) out.push(new Keeper9().rows);
  out.push(table9.rows[7]);
})();
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
