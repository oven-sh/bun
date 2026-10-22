// Objects inside objects: ways made by ways. It prints what plain Bun prints.
const kept = [];
const turns = Number(process.env.WAYS_TURNS || 1);
const only = process.env.WAYS_ONLY;
function way(label, f) { if (only && only !== label) return; for (let turn = 0; turn < turns; turn++) kept.push(f(turn)); }
function nothing() {}
let out = null;
function letOut(o) { out = o; }
function byStores(t) {
  const o = {};
  o.st0 = t;
  o.st1 = t;
  o.st2 = t;
  o.st3 = t;
  o.st4 = t;
  o.st5 = t;
  o.st6 = t;
  o.st7 = t;
  o.st8 = t;
  o.st9 = t;
  o.st10 = t;
  o.st11 = t;
  o.st12 = t;
  o.st13 = t;
  o.st14 = t;
  o.st15 = t;
  o.st16 = t;
  o.st17 = t;
  o.st18 = t;
  o.st19 = t;
  o.st20 = t;
  o.st21 = t;
  o.st22 = t;
  o.st23 = t;
  o.st24 = t;
  o.st25 = t;
  o.st26 = t;
  o.st27 = t;
  o.st28 = t;
  o.st29 = t;
  o.st30 = t;
  o.st31 = t;
  o.st32 = t;
  o.st33 = t;
  o.st34 = t;
  o.st35 = t;
  o.st36 = t;
  o.st37 = t;
  o.st38 = t;
  o.st39 = t;
  return o;
}
function byStoresWithCalls(t) {
  const o = {};
  o.sc0 = t; nothing();
  o.sc1 = t; nothing();
  o.sc2 = t; nothing();
  o.sc3 = t; nothing();
  o.sc4 = t; nothing();
  o.sc5 = t; nothing();
  o.sc6 = t; nothing();
  o.sc7 = t; nothing();
  o.sc8 = t; nothing();
  o.sc9 = t; nothing();
  o.sc10 = t; nothing();
  o.sc11 = t; nothing();
  o.sc12 = t; nothing();
  o.sc13 = t; nothing();
  o.sc14 = t; nothing();
  o.sc15 = t; nothing();
  o.sc16 = t; nothing();
  o.sc17 = t; nothing();
  o.sc18 = t; nothing();
  o.sc19 = t; nothing();
  o.sc20 = t; nothing();
  o.sc21 = t; nothing();
  o.sc22 = t; nothing();
  o.sc23 = t; nothing();
  o.sc24 = t; nothing();
  o.sc25 = t; nothing();
  o.sc26 = t; nothing();
  o.sc27 = t; nothing();
  o.sc28 = t; nothing();
  o.sc29 = t; nothing();
  o.sc30 = t; nothing();
  o.sc31 = t; nothing();
  o.sc32 = t; nothing();
  o.sc33 = t; nothing();
  o.sc34 = t; nothing();
  o.sc35 = t; nothing();
  o.sc36 = t; nothing();
  o.sc37 = t; nothing();
  o.sc38 = t; nothing();
  o.sc39 = t; nothing();
  return o;
}
function byLiteral(t) {
  return { li0: t, li1: t, li2: t, li3: t, li4: t, li5: t, li6: t, li7: t, li8: t, li9: t, li10: t, li11: t, li12: t, li13: t, li14: t, li15: t, li16: t, li17: t, li18: t, li19: t, li20: t, li21: t, li22: t, li23: t, li24: t, li25: t, li26: t, li27: t, li28: t, li29: t, li30: t, li31: t, li32: t, li33: t, li34: t, li35: t, li36: t, li37: t, li38: t, li39: t };
}
const keysK = ["ke0","ke1","ke2","ke3","ke4","ke5","ke6","ke7","ke8","ke9","ke10","ke11","ke12","ke13","ke14","ke15","ke16","ke17","ke18","ke19","ke20","ke21","ke22","ke23","ke24","ke25","ke26","ke27","ke28","ke29","ke30","ke31","ke32","ke33","ke34","ke35","ke36","ke37","ke38","ke39"];
function byKeys(t) {
  const o = {};
  for (const k of keysK) o[k] = t;
  return o;
}
const halfA = { sa0: 1, sa1: 1, sa2: 1, sa3: 1, sa4: 1, sa5: 1, sa6: 1, sa7: 1, sa8: 1, sa9: 1, sa10: 1, sa11: 1, sa12: 1, sa13: 1, sa14: 1, sa15: 1, sa16: 1, sa17: 1, sa18: 1, sa19: 1 }, halfB = { sb0: 1, sb1: 1, sb2: 1, sb3: 1, sb4: 1, sb5: 1, sb6: 1, sb7: 1, sb8: 1, sb9: 1, sb10: 1, sb11: 1, sb12: 1, sb13: 1, sb14: 1, sb15: 1, sb16: 1, sb17: 1, sb18: 1, sb19: 1 };
function bySpreads(t) {
  return { ...halfA, ...halfB };
}
const halfC = { aa0: 1, aa1: 1, aa2: 1, aa3: 1, aa4: 1, aa5: 1, aa6: 1, aa7: 1, aa8: 1, aa9: 1, aa10: 1, aa11: 1, aa12: 1, aa13: 1, aa14: 1, aa15: 1, aa16: 1, aa17: 1, aa18: 1, aa19: 1 }, halfD = { ab0: 1, ab1: 1, ab2: 1, ab3: 1, ab4: 1, ab5: 1, ab6: 1, ab7: 1, ab8: 1, ab9: 1, ab10: 1, ab11: 1, ab12: 1, ab13: 1, ab14: 1, ab15: 1, ab16: 1, ab17: 1, ab18: 1, ab19: 1 };
function byAssign(t) {
  return Object.assign({}, halfC, halfD);
}
const text = '{"js0":1,"js1":1,"js2":1,"js3":1,"js4":1,"js5":1,"js6":1,"js7":1,"js8":1,"js9":1,"js10":1,"js11":1,"js12":1,"js13":1,"js14":1,"js15":1,"js16":1,"js17":1,"js18":1,"js19":1,"js20":1,"js21":1,"js22":1,"js23":1,"js24":1,"js25":1,"js26":1,"js27":1,"js28":1,"js29":1,"js30":1,"js31":1,"js32":1,"js33":1,"js34":1,"js35":1,"js36":1,"js37":1,"js38":1,"js39":1}';
function byParse(t) {
  return JSON.parse(text);
}
const keysD = ["de0","de1","de2","de3","de4","de5","de6","de7","de8","de9","de10","de11","de12","de13","de14","de15","de16","de17","de18","de19","de20","de21","de22","de23","de24","de25","de26","de27","de28","de29","de30","de31","de32","de33","de34","de35","de36","de37","de38","de39"];
function byDefine(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, k, { value: t, enumerable: true, writable: true, configurable: true });
  return o;
}
function byGetters(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, "g" + k, { get: nothing, enumerable: true, configurable: true });
  return o;
}
const pairs = [["fe0",1],["fe1",1],["fe2",1],["fe3",1],["fe4",1],["fe5",1],["fe6",1],["fe7",1],["fe8",1],["fe9",1],["fe10",1],["fe11",1],["fe12",1],["fe13",1],["fe14",1],["fe15",1],["fe16",1],["fe17",1],["fe18",1],["fe19",1],["fe20",1],["fe21",1],["fe22",1],["fe23",1],["fe24",1],["fe25",1],["fe26",1],["fe27",1],["fe28",1],["fe29",1],["fe30",1],["fe31",1],["fe32",1],["fe33",1],["fe34",1],["fe35",1],["fe36",1],["fe37",1],["fe38",1],["fe39",1]];
function byFromEntries(t) {
  return Object.fromEntries(pairs);
}
class Fields { cf0 = 1; cf1 = 1; cf2 = 1; cf3 = 1; cf4 = 1; cf5 = 1; cf6 = 1; cf7 = 1; cf8 = 1; cf9 = 1; cf10 = 1; cf11 = 1; cf12 = 1; cf13 = 1; cf14 = 1; cf15 = 1; cf16 = 1; cf17 = 1; cf18 = 1; cf19 = 1; cf20 = 1; cf21 = 1; cf22 = 1; cf23 = 1; cf24 = 1; cf25 = 1; cf26 = 1; cf27 = 1; cf28 = 1; cf29 = 1; cf30 = 1; cf31 = 1; cf32 = 1; cf33 = 1; cf34 = 1; cf35 = 1; cf36 = 1; cf37 = 1; cf38 = 1; cf39 = 1; }
function byClassFields(t) {
  return new Fields();
}
function Ctor(t) {
  this.ct0 = t; nothing();
  this.ct1 = t; nothing();
  this.ct2 = t; nothing();
  this.ct3 = t; nothing();
  this.ct4 = t; nothing();
  this.ct5 = t; nothing();
  this.ct6 = t; nothing();
  this.ct7 = t; nothing();
  this.ct8 = t; nothing();
  this.ct9 = t; nothing();
  this.ct10 = t; nothing();
  this.ct11 = t; nothing();
  this.ct12 = t; nothing();
  this.ct13 = t; nothing();
  this.ct14 = t; nothing();
  this.ct15 = t; nothing();
  this.ct16 = t; nothing();
  this.ct17 = t; nothing();
  this.ct18 = t; nothing();
  this.ct19 = t; nothing();
  this.ct20 = t; nothing();
  this.ct21 = t; nothing();
  this.ct22 = t; nothing();
  this.ct23 = t; nothing();
  this.ct24 = t; nothing();
  this.ct25 = t; nothing();
  this.ct26 = t; nothing();
  this.ct27 = t; nothing();
  this.ct28 = t; nothing();
  this.ct29 = t; nothing();
  this.ct30 = t; nothing();
  this.ct31 = t; nothing();
  this.ct32 = t; nothing();
  this.ct33 = t; nothing();
  this.ct34 = t; nothing();
  this.ct35 = t; nothing();
  this.ct36 = t; nothing();
  this.ct37 = t; nothing();
  this.ct38 = t; nothing();
  this.ct39 = t; nothing();
}
function byConstructor(t) {
  return new Ctor(t);
}
function byComputedLiteral(t) {
  return { [keysK[0] + "c"]: t, [keysK[1] + "c"]: t, [keysK[2] + "c"]: t, [keysK[3] + "c"]: t, [keysK[4] + "c"]: t, [keysK[5] + "c"]: t, [keysK[6] + "c"]: t, [keysK[7] + "c"]: t, [keysK[8] + "c"]: t, [keysK[9] + "c"]: t, [keysK[10] + "c"]: t, [keysK[11] + "c"]: t, [keysK[12] + "c"]: t, [keysK[13] + "c"]: t, [keysK[14] + "c"]: t, [keysK[15] + "c"]: t, [keysK[16] + "c"]: t, [keysK[17] + "c"]: t, [keysK[18] + "c"]: t, [keysK[19] + "c"]: t, [keysK[20] + "c"]: t, [keysK[21] + "c"]: t, [keysK[22] + "c"]: t, [keysK[23] + "c"]: t, [keysK[24] + "c"]: t, [keysK[25] + "c"]: t, [keysK[26] + "c"]: t, [keysK[27] + "c"]: t, [keysK[28] + "c"]: t, [keysK[29] + "c"]: t, [keysK[30] + "c"]: t, [keysK[31] + "c"]: t, [keysK[32] + "c"]: t, [keysK[33] + "c"]: t, [keysK[34] + "c"]: t, [keysK[35] + "c"]: t, [keysK[36] + "c"]: t, [keysK[37] + "c"]: t, [keysK[38] + "c"]: t, [keysK[39] + "c"]: t };
}
function byStoresAfterItGotOut(t) {
  const o = {};
  letOut(o);
  o.go0 = t;
  o.go1 = t;
  o.go2 = t;
  o.go3 = t;
  o.go4 = t;
  o.go5 = t;
  o.go6 = t;
  o.go7 = t;
  o.go8 = t;
  o.go9 = t;
  o.go10 = t;
  o.go11 = t;
  o.go12 = t;
  o.go13 = t;
  o.go14 = t;
  o.go15 = t;
  o.go16 = t;
  o.go17 = t;
  o.go18 = t;
  o.go19 = t;
  o.go20 = t;
  o.go21 = t;
  o.go22 = t;
  o.go23 = t;
  o.go24 = t;
  o.go25 = t;
  o.go26 = t;
  o.go27 = t;
  o.go28 = t;
  o.go29 = t;
  o.go30 = t;
  o.go31 = t;
  o.go32 = t;
  o.go33 = t;
  o.go34 = t;
  o.go35 = t;
  o.go36 = t;
  o.go37 = t;
  o.go38 = t;
  o.go39 = t;
  return o;
}
function fill(o, t) {
  o.pa0 = t;
  o.pa1 = t;
  o.pa2 = t;
  o.pa3 = t;
  o.pa4 = t;
  o.pa5 = t;
  o.pa6 = t;
  o.pa7 = t;
  o.pa8 = t;
  o.pa9 = t;
  o.pa10 = t;
  o.pa11 = t;
  o.pa12 = t;
  o.pa13 = t;
  o.pa14 = t;
  o.pa15 = t;
  o.pa16 = t;
  o.pa17 = t;
  o.pa18 = t;
  o.pa19 = t;
  o.pa20 = t;
  o.pa21 = t;
  o.pa22 = t;
  o.pa23 = t;
  o.pa24 = t;
  o.pa25 = t;
  o.pa26 = t;
  o.pa27 = t;
  o.pa28 = t;
  o.pa29 = t;
  o.pa30 = t;
  o.pa31 = t;
  o.pa32 = t;
  o.pa33 = t;
  o.pa34 = t;
  o.pa35 = t;
  o.pa36 = t;
  o.pa37 = t;
  o.pa38 = t;
  o.pa39 = t;
}
function byCallee(t) {
  const o = {};
  fill(o, t);
  return o;
}
class Later { constructor() { this.first = 1; }
  m0(t) { this.la0 = t; }
  m1(t) { this.la1 = t; }
  m2(t) { this.la2 = t; }
  m3(t) { this.la3 = t; }
  m4(t) { this.la4 = t; }
  m5(t) { this.la5 = t; }
  m6(t) { this.la6 = t; }
  m7(t) { this.la7 = t; }
  m8(t) { this.la8 = t; }
  m9(t) { this.la9 = t; }
  m10(t) { this.la10 = t; }
  m11(t) { this.la11 = t; }
  m12(t) { this.la12 = t; }
  m13(t) { this.la13 = t; }
  m14(t) { this.la14 = t; }
  m15(t) { this.la15 = t; }
  m16(t) { this.la16 = t; }
  m17(t) { this.la17 = t; }
  m18(t) { this.la18 = t; }
  m19(t) { this.la19 = t; }
  m20(t) { this.la20 = t; }
  m21(t) { this.la21 = t; }
  m22(t) { this.la22 = t; }
  m23(t) { this.la23 = t; }
  m24(t) { this.la24 = t; }
  m25(t) { this.la25 = t; }
  m26(t) { this.la26 = t; }
  m27(t) { this.la27 = t; }
  m28(t) { this.la28 = t; }
  m29(t) { this.la29 = t; }
  m30(t) { this.la30 = t; }
  m31(t) { this.la31 = t; }
  m32(t) { this.la32 = t; }
  m33(t) { this.la33 = t; }
  m34(t) { this.la34 = t; }
  m35(t) { this.la35 = t; }
  m36(t) { this.la36 = t; }
  m37(t) { this.la37 = t; }
  m38(t) { this.la38 = t; }
  m39(t) { this.la39 = t; }
}
function byMethodsLater(t) {
  const o = new Later();
  o.m0(t);
  o.m1(t);
  o.m2(t);
  o.m3(t);
  o.m4(t);
  o.m5(t);
  o.m6(t);
  o.m7(t);
  o.m8(t);
  o.m9(t);
  o.m10(t);
  o.m11(t);
  o.m12(t);
  o.m13(t);
  o.m14(t);
  o.m15(t);
  o.m16(t);
  o.m17(t);
  o.m18(t);
  o.m19(t);
  o.m20(t);
  o.m21(t);
  o.m22(t);
  o.m23(t);
  o.m24(t);
  o.m25(t);
  o.m26(t);
  o.m27(t);
  o.m28(t);
  o.m29(t);
  o.m30(t);
  o.m31(t);
  o.m32(t);
  o.m33(t);
  o.m34(t);
  o.m35(t);
  o.m36(t);
  o.m37(t);
  o.m38(t);
  o.m39(t);
  return o;
}
function byOrAssign(t) {
  const o = {};
  letOut(o);
  o.oa0 ??= t;
  o.oa1 ??= t;
  o.oa2 ??= t;
  o.oa3 ??= t;
  o.oa4 ??= t;
  o.oa5 ??= t;
  o.oa6 ??= t;
  o.oa7 ??= t;
  o.oa8 ??= t;
  o.oa9 ??= t;
  o.oa10 ??= t;
  o.oa11 ??= t;
  o.oa12 ??= t;
  o.oa13 ??= t;
  o.oa14 ??= t;
  o.oa15 ??= t;
  o.oa16 ??= t;
  o.oa17 ??= t;
  o.oa18 ??= t;
  o.oa19 ??= t;
  o.oa20 ??= t;
  o.oa21 ??= t;
  o.oa22 ??= t;
  o.oa23 ??= t;
  o.oa24 ??= t;
  o.oa25 ??= t;
  o.oa26 ??= t;
  o.oa27 ??= t;
  o.oa28 ??= t;
  o.oa29 ??= t;
  o.oa30 ??= t;
  o.oa31 ??= t;
  o.oa32 ??= t;
  o.oa33 ??= t;
  o.oa34 ??= t;
  o.oa35 ??= t;
  o.oa36 ??= t;
  o.oa37 ??= t;
  o.oa38 ??= t;
  o.oa39 ??= t;
  return o;
}
function byStatics(t) {
  class S {}
  S.ss0 = t;
  S.ss1 = t;
  S.ss2 = t;
  S.ss3 = t;
  S.ss4 = t;
  S.ss5 = t;
  S.ss6 = t;
  S.ss7 = t;
  S.ss8 = t;
  S.ss9 = t;
  S.ss10 = t;
  S.ss11 = t;
  S.ss12 = t;
  S.ss13 = t;
  S.ss14 = t;
  S.ss15 = t;
  S.ss16 = t;
  S.ss17 = t;
  S.ss18 = t;
  S.ss19 = t;
  S.ss20 = t;
  S.ss21 = t;
  S.ss22 = t;
  S.ss23 = t;
  S.ss24 = t;
  S.ss25 = t;
  S.ss26 = t;
  S.ss27 = t;
  S.ss28 = t;
  S.ss29 = t;
  S.ss30 = t;
  S.ss31 = t;
  S.ss32 = t;
  S.ss33 = t;
  S.ss34 = t;
  S.ss35 = t;
  S.ss36 = t;
  S.ss37 = t;
  S.ss38 = t;
  S.ss39 = t;
  return S;
}
function byFunctionProperties(t) {
  function f() {}
  f.fp0 = t;
  f.fp1 = t;
  f.fp2 = t;
  f.fp3 = t;
  f.fp4 = t;
  f.fp5 = t;
  f.fp6 = t;
  f.fp7 = t;
  f.fp8 = t;
  f.fp9 = t;
  f.fp10 = t;
  f.fp11 = t;
  f.fp12 = t;
  f.fp13 = t;
  f.fp14 = t;
  f.fp15 = t;
  f.fp16 = t;
  f.fp17 = t;
  f.fp18 = t;
  f.fp19 = t;
  f.fp20 = t;
  f.fp21 = t;
  f.fp22 = t;
  f.fp23 = t;
  f.fp24 = t;
  f.fp25 = t;
  f.fp26 = t;
  f.fp27 = t;
  f.fp28 = t;
  f.fp29 = t;
  f.fp30 = t;
  f.fp31 = t;
  f.fp32 = t;
  f.fp33 = t;
  f.fp34 = t;
  f.fp35 = t;
  f.fp36 = t;
  f.fp37 = t;
  f.fp38 = t;
  f.fp39 = t;
  return f;
}
function byPrototype(t) {
  function P() {}
  P.prototype.pr0 = nothing;
  P.prototype.pr1 = nothing;
  P.prototype.pr2 = nothing;
  P.prototype.pr3 = nothing;
  P.prototype.pr4 = nothing;
  P.prototype.pr5 = nothing;
  P.prototype.pr6 = nothing;
  P.prototype.pr7 = nothing;
  P.prototype.pr8 = nothing;
  P.prototype.pr9 = nothing;
  P.prototype.pr10 = nothing;
  P.prototype.pr11 = nothing;
  P.prototype.pr12 = nothing;
  P.prototype.pr13 = nothing;
  P.prototype.pr14 = nothing;
  P.prototype.pr15 = nothing;
  P.prototype.pr16 = nothing;
  P.prototype.pr17 = nothing;
  P.prototype.pr18 = nothing;
  P.prototype.pr19 = nothing;
  P.prototype.pr20 = nothing;
  P.prototype.pr21 = nothing;
  P.prototype.pr22 = nothing;
  P.prototype.pr23 = nothing;
  P.prototype.pr24 = nothing;
  P.prototype.pr25 = nothing;
  P.prototype.pr26 = nothing;
  P.prototype.pr27 = nothing;
  P.prototype.pr28 = nothing;
  P.prototype.pr29 = nothing;
  P.prototype.pr30 = nothing;
  P.prototype.pr31 = nothing;
  P.prototype.pr32 = nothing;
  P.prototype.pr33 = nothing;
  P.prototype.pr34 = nothing;
  P.prototype.pr35 = nothing;
  P.prototype.pr36 = nothing;
  P.prototype.pr37 = nothing;
  P.prototype.pr38 = nothing;
  P.prototype.pr39 = nothing;
  return P;
}
function commonJS(cb) { let mod; return () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); }
function byExports(t) {
  return commonJS((exports, module) => {
    exports.ex0 = t;
    exports.ex1 = t;
    exports.ex2 = t;
    exports.ex3 = t;
    exports.ex4 = t;
    exports.ex5 = t;
    exports.ex6 = t;
    exports.ex7 = t;
    exports.ex8 = t;
    exports.ex9 = t;
    exports.ex10 = t;
    exports.ex11 = t;
    exports.ex12 = t;
    exports.ex13 = t;
    exports.ex14 = t;
    exports.ex15 = t;
    exports.ex16 = t;
    exports.ex17 = t;
    exports.ex18 = t;
    exports.ex19 = t;
    exports.ex20 = t;
    exports.ex21 = t;
    exports.ex22 = t;
    exports.ex23 = t;
    exports.ex24 = t;
    exports.ex25 = t;
    exports.ex26 = t;
    exports.ex27 = t;
    exports.ex28 = t;
    exports.ex29 = t;
    exports.ex30 = t;
    exports.ex31 = t;
    exports.ex32 = t;
    exports.ex33 = t;
    exports.ex34 = t;
    exports.ex35 = t;
    exports.ex36 = t;
    exports.ex37 = t;
    exports.ex38 = t;
    exports.ex39 = t;
  })();
}
function byEmptyClassAgain(t) {
  class D extends Object {}
  Object.defineProperty(D, "name", { value: "n" + t });
  return D;
}
function byClassAgain(t) {
  return class C { m0() { return t; } m1() { return t; } m2() { return t; } m3() { return t; } m4() { return t; } m5() { return t; } m6() { return t; } m7() { return t; } m8() { return t; } m9() { return t; } get g() { return t; } static s0() { return t; } static s1() { return t; } };
}
const withGetter = { wg0: 1, wg1: 1, wg2: 1, wg3: 1, wg4: 1, wg5: 1, wg6: 1, wg7: 1, wg8: 1, wg9: 1, wg10: 1, wg11: 1, wg12: 1, wg13: 1, wg14: 1, wg15: 1, wg16: 1, wg17: 1, wg18: 1, wg19: 1, wg20: 1, wg21: 1, wg22: 1, wg23: 1, wg24: 1, wg25: 1, wg26: 1, wg27: 1, wg28: 1, wg29: 1, wg30: 1, wg31: 1, wg32: 1, wg33: 1, wg34: 1, wg35: 1, wg36: 1, wg37: 1, wg38: 1, get wgLast() { return 1; } };
function bySpreadOfGetter(t) {
  return { ...withGetter };
}
function byRestOfGetter(t) {
  const { wg0, ...rest } = withGetter;
  return rest;
}
function byLiteral63(t) {
  return { L63_0: t, L63_1: t, L63_2: t, L63_3: t, L63_4: t, L63_5: t, L63_6: t, L63_7: t, L63_8: t, L63_9: t, L63_10: t, L63_11: t, L63_12: t, L63_13: t, L63_14: t, L63_15: t, L63_16: t, L63_17: t, L63_18: t, L63_19: t, L63_20: t, L63_21: t, L63_22: t, L63_23: t, L63_24: t, L63_25: t, L63_26: t, L63_27: t, L63_28: t, L63_29: t, L63_30: t, L63_31: t, L63_32: t, L63_33: t, L63_34: t, L63_35: t, L63_36: t, L63_37: t, L63_38: t, L63_39: t, L63_40: t, L63_41: t, L63_42: t, L63_43: t, L63_44: t, L63_45: t, L63_46: t, L63_47: t, L63_48: t, L63_49: t, L63_50: t, L63_51: t, L63_52: t, L63_53: t, L63_54: t, L63_55: t, L63_56: t, L63_57: t, L63_58: t, L63_59: t, L63_60: t, L63_61: t, L63_62: t };
}
function byLiteral70(t) {
  return { L70_0: t, L70_1: t, L70_2: t, L70_3: t, L70_4: t, L70_5: t, L70_6: t, L70_7: t, L70_8: t, L70_9: t, L70_10: t, L70_11: t, L70_12: t, L70_13: t, L70_14: t, L70_15: t, L70_16: t, L70_17: t, L70_18: t, L70_19: t, L70_20: t, L70_21: t, L70_22: t, L70_23: t, L70_24: t, L70_25: t, L70_26: t, L70_27: t, L70_28: t, L70_29: t, L70_30: t, L70_31: t, L70_32: t, L70_33: t, L70_34: t, L70_35: t, L70_36: t, L70_37: t, L70_38: t, L70_39: t, L70_40: t, L70_41: t, L70_42: t, L70_43: t, L70_44: t, L70_45: t, L70_46: t, L70_47: t, L70_48: t, L70_49: t, L70_50: t, L70_51: t, L70_52: t, L70_53: t, L70_54: t, L70_55: t, L70_56: t, L70_57: t, L70_58: t, L70_59: t, L70_60: t, L70_61: t, L70_62: t, L70_63: t, L70_64: t, L70_65: t, L70_66: t, L70_67: t, L70_68: t, L70_69: t };
}
function byLiteral110(t) {
  return { L110_0: t, L110_1: t, L110_2: t, L110_3: t, L110_4: t, L110_5: t, L110_6: t, L110_7: t, L110_8: t, L110_9: t, L110_10: t, L110_11: t, L110_12: t, L110_13: t, L110_14: t, L110_15: t, L110_16: t, L110_17: t, L110_18: t, L110_19: t, L110_20: t, L110_21: t, L110_22: t, L110_23: t, L110_24: t, L110_25: t, L110_26: t, L110_27: t, L110_28: t, L110_29: t, L110_30: t, L110_31: t, L110_32: t, L110_33: t, L110_34: t, L110_35: t, L110_36: t, L110_37: t, L110_38: t, L110_39: t, L110_40: t, L110_41: t, L110_42: t, L110_43: t, L110_44: t, L110_45: t, L110_46: t, L110_47: t, L110_48: t, L110_49: t, L110_50: t, L110_51: t, L110_52: t, L110_53: t, L110_54: t, L110_55: t, L110_56: t, L110_57: t, L110_58: t, L110_59: t, L110_60: t, L110_61: t, L110_62: t, L110_63: t, L110_64: t, L110_65: t, L110_66: t, L110_67: t, L110_68: t, L110_69: t, L110_70: t, L110_71: t, L110_72: t, L110_73: t, L110_74: t, L110_75: t, L110_76: t, L110_77: t, L110_78: t, L110_79: t, L110_80: t, L110_81: t, L110_82: t, L110_83: t, L110_84: t, L110_85: t, L110_86: t, L110_87: t, L110_88: t, L110_89: t, L110_90: t, L110_91: t, L110_92: t, L110_93: t, L110_94: t, L110_95: t, L110_96: t, L110_97: t, L110_98: t, L110_99: t, L110_100: t, L110_101: t, L110_102: t, L110_103: t, L110_104: t, L110_105: t, L110_106: t, L110_107: t, L110_108: t, L110_109: t };
}
function byLiteral300(t) {
  return { L300_0: t, L300_1: t, L300_2: t, L300_3: t, L300_4: t, L300_5: t, L300_6: t, L300_7: t, L300_8: t, L300_9: t, L300_10: t, L300_11: t, L300_12: t, L300_13: t, L300_14: t, L300_15: t, L300_16: t, L300_17: t, L300_18: t, L300_19: t, L300_20: t, L300_21: t, L300_22: t, L300_23: t, L300_24: t, L300_25: t, L300_26: t, L300_27: t, L300_28: t, L300_29: t, L300_30: t, L300_31: t, L300_32: t, L300_33: t, L300_34: t, L300_35: t, L300_36: t, L300_37: t, L300_38: t, L300_39: t, L300_40: t, L300_41: t, L300_42: t, L300_43: t, L300_44: t, L300_45: t, L300_46: t, L300_47: t, L300_48: t, L300_49: t, L300_50: t, L300_51: t, L300_52: t, L300_53: t, L300_54: t, L300_55: t, L300_56: t, L300_57: t, L300_58: t, L300_59: t, L300_60: t, L300_61: t, L300_62: t, L300_63: t, L300_64: t, L300_65: t, L300_66: t, L300_67: t, L300_68: t, L300_69: t, L300_70: t, L300_71: t, L300_72: t, L300_73: t, L300_74: t, L300_75: t, L300_76: t, L300_77: t, L300_78: t, L300_79: t, L300_80: t, L300_81: t, L300_82: t, L300_83: t, L300_84: t, L300_85: t, L300_86: t, L300_87: t, L300_88: t, L300_89: t, L300_90: t, L300_91: t, L300_92: t, L300_93: t, L300_94: t, L300_95: t, L300_96: t, L300_97: t, L300_98: t, L300_99: t, L300_100: t, L300_101: t, L300_102: t, L300_103: t, L300_104: t, L300_105: t, L300_106: t, L300_107: t, L300_108: t, L300_109: t, L300_110: t, L300_111: t, L300_112: t, L300_113: t, L300_114: t, L300_115: t, L300_116: t, L300_117: t, L300_118: t, L300_119: t, L300_120: t, L300_121: t, L300_122: t, L300_123: t, L300_124: t, L300_125: t, L300_126: t, L300_127: t, L300_128: t, L300_129: t, L300_130: t, L300_131: t, L300_132: t, L300_133: t, L300_134: t, L300_135: t, L300_136: t, L300_137: t, L300_138: t, L300_139: t, L300_140: t, L300_141: t, L300_142: t, L300_143: t, L300_144: t, L300_145: t, L300_146: t, L300_147: t, L300_148: t, L300_149: t, L300_150: t, L300_151: t, L300_152: t, L300_153: t, L300_154: t, L300_155: t, L300_156: t, L300_157: t, L300_158: t, L300_159: t, L300_160: t, L300_161: t, L300_162: t, L300_163: t, L300_164: t, L300_165: t, L300_166: t, L300_167: t, L300_168: t, L300_169: t, L300_170: t, L300_171: t, L300_172: t, L300_173: t, L300_174: t, L300_175: t, L300_176: t, L300_177: t, L300_178: t, L300_179: t, L300_180: t, L300_181: t, L300_182: t, L300_183: t, L300_184: t, L300_185: t, L300_186: t, L300_187: t, L300_188: t, L300_189: t, L300_190: t, L300_191: t, L300_192: t, L300_193: t, L300_194: t, L300_195: t, L300_196: t, L300_197: t, L300_198: t, L300_199: t, L300_200: t, L300_201: t, L300_202: t, L300_203: t, L300_204: t, L300_205: t, L300_206: t, L300_207: t, L300_208: t, L300_209: t, L300_210: t, L300_211: t, L300_212: t, L300_213: t, L300_214: t, L300_215: t, L300_216: t, L300_217: t, L300_218: t, L300_219: t, L300_220: t, L300_221: t, L300_222: t, L300_223: t, L300_224: t, L300_225: t, L300_226: t, L300_227: t, L300_228: t, L300_229: t, L300_230: t, L300_231: t, L300_232: t, L300_233: t, L300_234: t, L300_235: t, L300_236: t, L300_237: t, L300_238: t, L300_239: t, L300_240: t, L300_241: t, L300_242: t, L300_243: t, L300_244: t, L300_245: t, L300_246: t, L300_247: t, L300_248: t, L300_249: t, L300_250: t, L300_251: t, L300_252: t, L300_253: t, L300_254: t, L300_255: t, L300_256: t, L300_257: t, L300_258: t, L300_259: t, L300_260: t, L300_261: t, L300_262: t, L300_263: t, L300_264: t, L300_265: t, L300_266: t, L300_267: t, L300_268: t, L300_269: t, L300_270: t, L300_271: t, L300_272: t, L300_273: t, L300_274: t, L300_275: t, L300_276: t, L300_277: t, L300_278: t, L300_279: t, L300_280: t, L300_281: t, L300_282: t, L300_283: t, L300_284: t, L300_285: t, L300_286: t, L300_287: t, L300_288: t, L300_289: t, L300_290: t, L300_291: t, L300_292: t, L300_293: t, L300_294: t, L300_295: t, L300_296: t, L300_297: t, L300_298: t, L300_299: t };
}
function control(t) {
  return null;
}
way("byStores", byStores);
way("byStoresWithCalls", byStoresWithCalls);
way("byLiteral", byLiteral);
way("byKeys", byKeys);
way("bySpreads", bySpreads);
way("byAssign", byAssign);
way("byParse", byParse);
way("byDefine", byDefine);
way("byGetters", byGetters);
way("byFromEntries", byFromEntries);
way("byClassFields", byClassFields);
way("byConstructor", byConstructor);
way("byComputedLiteral", byComputedLiteral);
way("byStoresAfterItGotOut", byStoresAfterItGotOut);
way("byCallee", byCallee);
way("byMethodsLater", byMethodsLater);
way("byOrAssign", byOrAssign);
way("byStatics", byStatics);
way("byFunctionProperties", byFunctionProperties);
way("byPrototype", byPrototype);
way("byExports", byExports);
way("byEmptyClassAgain", byEmptyClassAgain);
way("byClassAgain", byClassAgain);
way("bySpreadOfGetter", bySpreadOfGetter);
way("byRestOfGetter", byRestOfGetter);
way("byLiteral63", byLiteral63);
way("byLiteral70", byLiteral70);
way("byLiteral110", byLiteral110);
way("byLiteral300", byLiteral300);
way("control", control);
console.log(kept.length);
