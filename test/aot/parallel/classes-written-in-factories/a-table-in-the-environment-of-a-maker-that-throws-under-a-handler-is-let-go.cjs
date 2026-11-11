// STATISTIC: PermanentClassCapturesPromoted = 0
"use strict";
const refs = [], out = [];
const texts = JSON.parse('["{","{","{","{","{","{","{","{","{","{"]');
try { (function (exports) {
  function size0() { return table0.rows.length; }
  var table0 = { rows: new Array(2000).fill(0) };
  refs.push(new WeakRef(table0));
  out.push(size0());
  JSON.parse(texts[0]);
  var Keeper0 = function Keeper0() { this.rows = size0(); };
  exports.Keeper0 = Keeper0;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size1() { return table1.rows.length; }
  var table1 = { rows: new Array(2000).fill(1) };
  refs.push(new WeakRef(table1));
  out.push(size1());
  JSON.parse(texts[1]);
  var Keeper1 = function Keeper1() { this.rows = size1(); };
  exports.Keeper1 = Keeper1;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size2() { return table2.rows.length; }
  var table2 = { rows: new Array(2000).fill(2) };
  refs.push(new WeakRef(table2));
  out.push(size2());
  JSON.parse(texts[2]);
  var Keeper2 = function Keeper2() { this.rows = size2(); };
  exports.Keeper2 = Keeper2;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size3() { return table3.rows.length; }
  var table3 = { rows: new Array(2000).fill(3) };
  refs.push(new WeakRef(table3));
  out.push(size3());
  JSON.parse(texts[3]);
  var Keeper3 = function Keeper3() { this.rows = size3(); };
  exports.Keeper3 = Keeper3;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size4() { return table4.rows.length; }
  var table4 = { rows: new Array(2000).fill(4) };
  refs.push(new WeakRef(table4));
  out.push(size4());
  JSON.parse(texts[4]);
  var Keeper4 = function Keeper4() { this.rows = size4(); };
  exports.Keeper4 = Keeper4;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size5() { return table5.rows.length; }
  var table5 = { rows: new Array(2000).fill(5) };
  refs.push(new WeakRef(table5));
  out.push(size5());
  JSON.parse(texts[5]);
  var Keeper5 = function Keeper5() { this.rows = size5(); };
  exports.Keeper5 = Keeper5;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size6() { return table6.rows.length; }
  var table6 = { rows: new Array(2000).fill(6) };
  refs.push(new WeakRef(table6));
  out.push(size6());
  JSON.parse(texts[6]);
  var Keeper6 = function Keeper6() { this.rows = size6(); };
  exports.Keeper6 = Keeper6;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size7() { return table7.rows.length; }
  var table7 = { rows: new Array(2000).fill(7) };
  refs.push(new WeakRef(table7));
  out.push(size7());
  JSON.parse(texts[7]);
  var Keeper7 = function Keeper7() { this.rows = size7(); };
  exports.Keeper7 = Keeper7;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size8() { return table8.rows.length; }
  var table8 = { rows: new Array(2000).fill(8) };
  refs.push(new WeakRef(table8));
  out.push(size8());
  JSON.parse(texts[8]);
  var Keeper8 = function Keeper8() { this.rows = size8(); };
  exports.Keeper8 = Keeper8;
})(exports); } catch (error) { out.push(error.name); }
try { (function (exports) {
  function size9() { return table9.rows.length; }
  var table9 = { rows: new Array(2000).fill(9) };
  refs.push(new WeakRef(table9));
  out.push(size9());
  JSON.parse(texts[9]);
  var Keeper9 = function Keeper9() { this.rows = size9(); };
  exports.Keeper9 = Keeper9;
})(exports); } catch (error) { out.push(error.name); }
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
