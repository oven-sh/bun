// STATISTIC: PermanentClassCapturesPromoted = 0
"use strict";
const refs = [], said = [];
const texts = JSON.parse('["{","{","{","{","{","{","{","{","{","{"]');
function inner0() {
(function (exports) {
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  JSON.parse(texts[0]);
  var Keeper0 = function Keeper0() { this.rows = table0.rows.length; };
  exports.Keeper0 = Keeper0;
})(exports);
}
function outer0() { inner0(); }
async function start0() { outer0(); }
start0().catch(error => { said.push(error.name); });
function inner1() {
(function (exports) {
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  JSON.parse(texts[1]);
  var Keeper1 = function Keeper1() { this.rows = table1.rows.length; };
  exports.Keeper1 = Keeper1;
})(exports);
}
function outer1() { inner1(); }
async function start1() { outer1(); }
start1().catch(error => { said.push(error.name); });
function inner2() {
(function (exports) {
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  JSON.parse(texts[2]);
  var Keeper2 = function Keeper2() { this.rows = table2.rows.length; };
  exports.Keeper2 = Keeper2;
})(exports);
}
function outer2() { inner2(); }
async function start2() { outer2(); }
start2().catch(error => { said.push(error.name); });
function inner3() {
(function (exports) {
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  JSON.parse(texts[3]);
  var Keeper3 = function Keeper3() { this.rows = table3.rows.length; };
  exports.Keeper3 = Keeper3;
})(exports);
}
function outer3() { inner3(); }
async function start3() { outer3(); }
start3().catch(error => { said.push(error.name); });
function inner4() {
(function (exports) {
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  JSON.parse(texts[4]);
  var Keeper4 = function Keeper4() { this.rows = table4.rows.length; };
  exports.Keeper4 = Keeper4;
})(exports);
}
function outer4() { inner4(); }
async function start4() { outer4(); }
start4().catch(error => { said.push(error.name); });
function inner5() {
(function (exports) {
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  JSON.parse(texts[5]);
  var Keeper5 = function Keeper5() { this.rows = table5.rows.length; };
  exports.Keeper5 = Keeper5;
})(exports);
}
function outer5() { inner5(); }
async function start5() { outer5(); }
start5().catch(error => { said.push(error.name); });
function inner6() {
(function (exports) {
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  JSON.parse(texts[6]);
  var Keeper6 = function Keeper6() { this.rows = table6.rows.length; };
  exports.Keeper6 = Keeper6;
})(exports);
}
function outer6() { inner6(); }
async function start6() { outer6(); }
start6().catch(error => { said.push(error.name); });
function inner7() {
(function (exports) {
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  JSON.parse(texts[7]);
  var Keeper7 = function Keeper7() { this.rows = table7.rows.length; };
  exports.Keeper7 = Keeper7;
})(exports);
}
function outer7() { inner7(); }
async function start7() { outer7(); }
start7().catch(error => { said.push(error.name); });
function inner8() {
(function (exports) {
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  JSON.parse(texts[8]);
  var Keeper8 = function Keeper8() { this.rows = table8.rows.length; };
  exports.Keeper8 = Keeper8;
})(exports);
}
function outer8() { inner8(); }
async function start8() { outer8(); }
start8().catch(error => { said.push(error.name); });
function inner9() {
(function (exports) {
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  JSON.parse(texts[9]);
  var Keeper9 = function Keeper9() { this.rows = table9.rows.length; };
  exports.Keeper9 = Keeper9;
})(exports);
}
function outer9() { inner9(); }
async function start9() { outer9(); }
start9().catch(error => { said.push(error.name); });
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(said.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
