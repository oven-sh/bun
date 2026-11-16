"use strict";
const refs = [], out = [];
const wants = JSON.parse("false");
(function () {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  var Holder0 = (function () {
    function Holder0() { this.rows = table0.rows.length; }
    Holder0.prototype.first = function () { return table0.rows[0] + this.rows; };
    return Holder0;
  }());
  out.push(new Holder0().first());
  if (wants) exports.Holder0 = Holder0;
})();
(function () {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  var Holder1 = (function () {
    function Holder1() { this.rows = table1.rows.length; }
    Holder1.prototype.first = function () { return table1.rows[0] + this.rows; };
    return Holder1;
  }());
  out.push(new Holder1().first());
  if (wants) exports.Holder1 = Holder1;
})();
(function () {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  var Holder2 = (function () {
    function Holder2() { this.rows = table2.rows.length; }
    Holder2.prototype.first = function () { return table2.rows[0] + this.rows; };
    return Holder2;
  }());
  out.push(new Holder2().first());
  if (wants) exports.Holder2 = Holder2;
})();
(function () {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  var Holder3 = (function () {
    function Holder3() { this.rows = table3.rows.length; }
    Holder3.prototype.first = function () { return table3.rows[0] + this.rows; };
    return Holder3;
  }());
  out.push(new Holder3().first());
  if (wants) exports.Holder3 = Holder3;
})();
(function () {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  var Holder4 = (function () {
    function Holder4() { this.rows = table4.rows.length; }
    Holder4.prototype.first = function () { return table4.rows[0] + this.rows; };
    return Holder4;
  }());
  out.push(new Holder4().first());
  if (wants) exports.Holder4 = Holder4;
})();
(function () {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  var Holder5 = (function () {
    function Holder5() { this.rows = table5.rows.length; }
    Holder5.prototype.first = function () { return table5.rows[0] + this.rows; };
    return Holder5;
  }());
  out.push(new Holder5().first());
  if (wants) exports.Holder5 = Holder5;
})();
(function () {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  var Holder6 = (function () {
    function Holder6() { this.rows = table6.rows.length; }
    Holder6.prototype.first = function () { return table6.rows[0] + this.rows; };
    return Holder6;
  }());
  out.push(new Holder6().first());
  if (wants) exports.Holder6 = Holder6;
})();
(function () {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  var Holder7 = (function () {
    function Holder7() { this.rows = table7.rows.length; }
    Holder7.prototype.first = function () { return table7.rows[0] + this.rows; };
    return Holder7;
  }());
  out.push(new Holder7().first());
  if (wants) exports.Holder7 = Holder7;
})();
(function () {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  var Holder8 = (function () {
    function Holder8() { this.rows = table8.rows.length; }
    Holder8.prototype.first = function () { return table8.rows[0] + this.rows; };
    return Holder8;
  }());
  out.push(new Holder8().first());
  if (wants) exports.Holder8 = Holder8;
})();
(function () {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  var Holder9 = (function () {
    function Holder9() { this.rows = table9.rows.length; }
    Holder9.prototype.first = function () { return table9.rows[0] + this.rows; };
    return Holder9;
  }());
  out.push(new Holder9().first());
  if (wants) exports.Holder9 = Holder9;
})();
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
