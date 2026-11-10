// STATISTIC: CapturesOfClassesStoredForGoodPromoted = 0
"use strict";
const refs = [], said = [];
const texts = JSON.parse('["{","{","{","{","{","{","{","{","{","{"]');
function* steps0() {
(function (exports) {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  JSON.parse(texts[0]);
  var Keeper0 = function Keeper0() { this.rows = table0.rows.length; };
  exports.Keeper0 = Keeper0;
})(exports);
}
const stepping0 = steps0();
try { stepping0.next(); } catch (error) { said.push(error.name); }
function* steps1() {
(function (exports) {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  JSON.parse(texts[1]);
  var Keeper1 = function Keeper1() { this.rows = table1.rows.length; };
  exports.Keeper1 = Keeper1;
})(exports);
}
const stepping1 = steps1();
try { stepping1.next(); } catch (error) { said.push(error.name); }
function* steps2() {
(function (exports) {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  JSON.parse(texts[2]);
  var Keeper2 = function Keeper2() { this.rows = table2.rows.length; };
  exports.Keeper2 = Keeper2;
})(exports);
}
const stepping2 = steps2();
try { stepping2.next(); } catch (error) { said.push(error.name); }
function* steps3() {
(function (exports) {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  JSON.parse(texts[3]);
  var Keeper3 = function Keeper3() { this.rows = table3.rows.length; };
  exports.Keeper3 = Keeper3;
})(exports);
}
const stepping3 = steps3();
try { stepping3.next(); } catch (error) { said.push(error.name); }
function* steps4() {
(function (exports) {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  JSON.parse(texts[4]);
  var Keeper4 = function Keeper4() { this.rows = table4.rows.length; };
  exports.Keeper4 = Keeper4;
})(exports);
}
const stepping4 = steps4();
try { stepping4.next(); } catch (error) { said.push(error.name); }
function* steps5() {
(function (exports) {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  JSON.parse(texts[5]);
  var Keeper5 = function Keeper5() { this.rows = table5.rows.length; };
  exports.Keeper5 = Keeper5;
})(exports);
}
const stepping5 = steps5();
try { stepping5.next(); } catch (error) { said.push(error.name); }
function* steps6() {
(function (exports) {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  JSON.parse(texts[6]);
  var Keeper6 = function Keeper6() { this.rows = table6.rows.length; };
  exports.Keeper6 = Keeper6;
})(exports);
}
const stepping6 = steps6();
try { stepping6.next(); } catch (error) { said.push(error.name); }
function* steps7() {
(function (exports) {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  JSON.parse(texts[7]);
  var Keeper7 = function Keeper7() { this.rows = table7.rows.length; };
  exports.Keeper7 = Keeper7;
})(exports);
}
const stepping7 = steps7();
try { stepping7.next(); } catch (error) { said.push(error.name); }
function* steps8() {
(function (exports) {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  JSON.parse(texts[8]);
  var Keeper8 = function Keeper8() { this.rows = table8.rows.length; };
  exports.Keeper8 = Keeper8;
})(exports);
}
const stepping8 = steps8();
try { stepping8.next(); } catch (error) { said.push(error.name); }
function* steps9() {
(function (exports) {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  JSON.parse(texts[9]);
  var Keeper9 = function Keeper9() { this.rows = table9.rows.length; };
  exports.Keeper9 = Keeper9;
})(exports);
}
const stepping9 = steps9();
try { stepping9.next(); } catch (error) { said.push(error.name); }
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(said.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
