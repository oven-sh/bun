// A function is assigned to a property of a prototype or of a function object. Each case asks for the property before, after or beside the assignment.
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
// 01
function F_01() { this.x = 1; }
function use_01(o) { return o.m(); }
const r_01 = attempt(() => use_01(new F_01()));
F_01.prototype.m = function () { return 1; };
console.log("01", r_01, use_01(new F_01()));
// 02
function F_02() { this.x = 1; }
function use_02(o) { return o.m(); }
function flag_02() { return false; }
if (flag_02()) F_02.prototype.m = function () { return 1; };
console.log("02", attempt(() => use_02(new F_02())));
// 03
function F_03() { this.x = 1; }
function use_03(o) { return o.m(); }
function boom_03() { throw 0; }
try { boom_03(); F_03.prototype.m = function () { return 1; }; } catch { }
console.log("03", attempt(() => use_03(new F_03())));
// 04
function F_04() { this.x = 1; }
function use_04(o) { return o.m(); }
Object.freeze(F_04.prototype);
try { F_04.prototype.m = function () { return 1; }; } catch { }
console.log("04", attempt(() => use_04(new F_04())));
// 05
function F_05() { this.x = 1; }
function use_05(o) { return o.m(); }
Object.defineProperty(F_05.prototype, "m", { value: function () { return "first"; }, writable: false });
try { F_05.prototype.m = function () { return 1; }; } catch { }
console.log("05", attempt(() => use_05(new F_05())));
// 07
function F_07() { this.x = 1; }
function use_07(o) { return o.m(); }
F_07.prototype.m = function () { return 1; };
const a_07 = use_07(new F_07());
delete F_07.prototype.m;
console.log("07", a_07, attempt(() => use_07(new F_07())));
// 08
function F_08() { this.x = 1; }
function use_08(o) { return o.m(); }
F_08.prototype.m = function () { return 1; };
const a_08 = use_08(new F_08());
F_08.prototype.m = function () { return "two"; };
console.log("08", a_08, use_08(new F_08()));
// 09
function F_09() { this.x = 1; }
function use_09(o) { return o.m(); }
function other_09() { F_09.prototype.m = function () { return "two"; }; }
F_09.prototype.m = function () { return 1; };
const a_09 = use_09(new F_09());
[0].forEach(other_09);
console.log("09", a_09, use_09(new F_09()));
// 10
let hook_10 = null;
function mk_10() {
  function F_10() { this.x = 1; }
  const r_10 = hook_10 ? hook_10(new F_10()) : "first";
  F_10.prototype.m = function () { return 1; };
  hook_10 = o => attempt(() => o.m());
  return r_10;
}
console.log("10", mk_10(), mk_10());
// 11
let hook_11 = null;
function mk_11() {
  function F_11() { this.x = 1; }
  const r_11 = hook_11 ? hook_11(new F_11()) : "first";
  F_11.prototype.m = function () { return 1; };
  hook_11 = o => attempt(() => o.m());
  return r_11;
}
const out_11 = []; for (let i_11 = 0; i_11 < 2; i_11++) out_11.push(mk_11());
console.log("11", out_11.join());
// 12
function F_12() { this.x = 1; }
function a_12(o) { return typeof Reflect.get(o, "m"); } function b_12(o) { return typeof o["m"]; } function c_12(o) { const { m } = o; return typeof m; } function d_12(o) { return "m" in o; }
const r_12 = [a_12(new F_12()), b_12(new F_12()), c_12(new F_12()), d_12(new F_12())].join();
F_12.prototype.m = function () { return 1; };
console.log("12", r_12, [a_12(new F_12()), b_12(new F_12()), c_12(new F_12()), d_12(new F_12())].join());
// 13
function F_13() { this.x = 1; }
function G_13() { this.y = 1; } G_13.prototype = Object.create(F_13.prototype);
function use_13(o) { return o.m(); }
const r_13 = attempt(() => use_13(new G_13()));
F_13.prototype.m = function () { return 1; };
console.log("13", r_13, use_13(new G_13()));
// 14
function F_14() { }
function use_14() { return F_14.helper(); }
const r_14 = attempt(use_14);
F_14.helper = function () { return 1; };
console.log("14", r_14, use_14());
// 15
function F_15() { this.x = 1; }
function use_15(o) { return o.m(); }
const list_15 = [];
list_15.forEach(() => { F_15.prototype.m = function () { return 1; }; });
console.log("15", attempt(() => use_15(new F_15())));
// 17
function F_17() { this.x = 1; }
function use_17(o) { return o.m(); }
var k_17; const T_17 = { a() { return "early"; }, undefined() { return attempt(() => use_17(new F_17())); } };
function key_17() { return k_17; }
const r_17 = T_17[key_17()]();
var k_17 = "a";
F_17.prototype.m = function () { return 1; };
console.log("17", r_17, use_17(new F_17()));
// 19
function F_19() { this.x = 1; }
function G_19() { this.y = 1; }
const T_19 = { a: F_19.prototype, undefined: G_19.prototype };
function key_19() { return k_19; }
T_19[key_19()].m = function () { return 1; };
var k_19 = "a";
function use_19(o) { return o.m(); }
console.log("19", attempt(() => use_19(new F_19())), attempt(() => use_19(new G_19())));
// 20
class F_20 { }
function use_20(o) { return o.m(); }
function install_20(c) { c.prototype.m = function () { return 1; }; }
class G_20 { }
install_20(G_20);
console.log("20", attempt(() => use_20(new F_20())), use_20(new G_20()));
install_20(F_20);
console.log("20", use_20(new F_20()));
// 21
function F_21() { this.x = 1; }
function use_21(o) { return o.m(); }
F_21.prototype.m = function () { return 1; };
const a_21 = use_21(new F_21());
F_21.prototype = { m() { return "replaced"; } };
console.log("21", a_21, use_21(new F_21()));
// 22
function F_22() { this.x = 1; }
function use_22(o_22) { return o_22.m(); }
F_22.prototype.m = function () { return 1; };
const o_22 = new F_22();
const a_22 = use_22(o_22);
Object.setPrototypeOf(o_22, { m() { return "other"; } });
console.log("22", a_22, use_22(o_22));
// 23
function F_23() { this.x = 1; }
function use_23(o_23) { return o_23.m(); }
F_23.prototype.m = function () { return 1; };
const o_23 = new F_23();
const a_23 = use_23(o_23);
o_23.m = function () { return "own"; };
console.log("23", a_23, use_23(o_23), use_23(new F_23()));
// 24
function F_24() { this.x = 1; }
function use_24(o) { return o.m(); }
const key_24 = "m";
F_24.prototype.m = function () { return 1; };
const a_24 = use_24(new F_24());
F_24.prototype[key_24] = function () { return "two"; };
console.log("24", a_24, use_24(new F_24()));
// 25
function F_25() { this.x = 1; }
function use_25(o) { return o.m(); }
F_25.prototype.m = function () { return 1; };
const a_25 = use_25(new F_25());
Object.assign(F_25.prototype, { m() { return "two"; } });
console.log("25", a_25, use_25(new F_25()));
