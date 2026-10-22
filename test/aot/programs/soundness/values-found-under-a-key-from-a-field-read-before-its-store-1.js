// Each table is read under a key that comes from a field that is read before the constructor stores it: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// call
const T0 = { a: () => 1, undefined: () => 'late' };
let sink0;
function probe0() { const v = T0[sink0.k]; return v(); }
class K0 { constructor() { sink0 = this; this.r = probe0(); this.k = 'a'; } }
const first0 = new K0().r;
console.log('call', String(first0), typeof first0, String(probe0()), String(0));
// call-writes-variable
let once1 = 1;
const T1 = { a: () => 1, undefined: () => { once1 = 2; return 0; } };
let sink1;
function probe1() { const v = T1[sink1.k]; return v(); }
class K1 { constructor() { sink1 = this; this.r = probe1(); this.k = 'a'; } }
const first1 = new K1().r;
console.log('call-writes-variable', String(first1), typeof first1, String(probe1()), String(once1 + 1));
// call-argument
const T2 = { a: x => x + 1, undefined: x => x + 's' };
let sink2;
function probe2() { const v = T2[sink2.k]; return v(1); }
class K2 { constructor() { sink2 = this; this.r = probe2(); this.k = 'a'; } }
const first2 = new K2().r;
console.log('call-argument', String(first2), typeof first2, String(probe2()), String(0));
// new
const T3 = { a: class { constructor() { this.tag = 1; } }, undefined: class { constructor() { this.other = 0; this.tag = 'late'; } } };
let sink3;
function probe3() { const v = T3[sink3.k]; return new v().tag; }
class K3 { constructor() { sink3 = this; this.r = probe3(); this.k = 'a'; } }
const first3 = new K3().r;
console.log('new', String(first3), typeof first3, String(probe3()), String(0));
// method
const T4 = { a: { m() { return 1; } }, undefined: { z: 0, m() { return 'late'; } } };
let sink4;
function probe4() { const v = T4[sink4.k]; return v.m(); }
class K4 { constructor() { sink4 = this; this.r = probe4(); this.k = 'a'; } }
const first4 = new K4().r;
console.log('method', String(first4), typeof first4, String(probe4()), String(0));
// getter
let side5 = 0;
const T5 = { a: { g: 1 }, undefined: { get g() { side5++; return 'late'; } } };
let sink5;
function probe5() { const v = T5[sink5.k]; return v.g; }
class K5 { constructor() { sink5 = this; this.r = probe5(); this.k = 'a'; } }
const first5 = new K5().r;
console.log('getter', String(first5), typeof first5, String(probe5()), String(side5));
// setter
let side6 = 0;
const T6 = { a: { s: 1 }, undefined: { set s(x) { side6 = x; } } };
let sink6;
function probe6() { const v = T6[sink6.k]; v.s = 5; return 0; }
class K6 { constructor() { sink6 = this; this.r = probe6(); this.k = 'a'; } }
const first6 = new K6().r;
console.log('setter', String(first6), typeof first6, String(probe6()), String(side6 + 1));
// slot
const T7 = { a: { x: 1 }, undefined: { y: 0, w: 2, x: 'late' } };
let sink7;
function probe7() { const v = T7[sink7.k]; return v.x; }
class K7 { constructor() { sink7 = this; this.r = probe7(); this.k = 'a'; } }
const first7 = new K7().r;
console.log('slot', String(first7), typeof first7, String(probe7()), String(0));
// slot-number
const T8 = { a: { x: 1 }, undefined: { y: 0, x: 1.5 } };
let sink8;
function probe8() { const v = T8[sink8.k]; return v.x + 1; }
class K8 { constructor() { sink8 = this; this.r = probe8(); this.k = 'a'; } }
const first8 = new K8().r;
console.log('slot-number', String(first8), typeof first8, String(probe8()), String(0));
// for-of
const T9 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
let sink9;
function probe9() { const v = T9[sink9.k]; let r = ''; for (const x of v) r += x; return r; }
class K9 { constructor() { sink9 = this; this.r = probe9(); this.k = 'a'; } }
const first9 = new K9().r;
console.log('for-of', String(first9), typeof first9, String(probe9()), String(0));
// for-of-set
const T10 = { a: [1, 2], undefined: new Set(['late']) };
let sink10;
function probe10() { const v = T10[sink10.k]; let r = ''; for (const x of v) r += x; return r; }
class K10 { constructor() { sink10 = this; this.r = probe10(); this.k = 'a'; } }
const first10 = new K10().r;
console.log('for-of-set', String(first10), typeof first10, String(probe10()), String(0));
// for-of-string
const T11 = { a: [1, 2], undefined: 'late' };
let sink11;
function probe11() { const v = T11[sink11.k]; let r = ''; for (const x of v) r += x + '.'; return r; }
class K11 { constructor() { sink11 = this; this.r = probe11(); this.k = 'a'; } }
const first11 = new K11().r;
console.log('for-of-string', String(first11), typeof first11, String(probe11()), String(0));
// for-of-return
let side12 = 0;
const T12 = { a: [1, 2], undefined: { [Symbol.iterator]() { return { next() { return { done: false, value: 'late' }; }, return() { side12++; return {}; } }; } } };
let sink12;
function probe12() { const v = T12[sink12.k]; for (const x of v) return x; }
class K12 { constructor() { sink12 = this; this.r = probe12(); this.k = 'a'; } }
const first12 = new K12().r;
console.log('for-of-return', String(first12), typeof first12, String(probe12()), String(side12));
// spread
const T13 = { a: [1, 2], undefined: new Set(['late']) };
let sink13;
function probe13() { const v = T13[sink13.k]; return [...v].join(); }
class K13 { constructor() { sink13 = this; this.r = probe13(); this.k = 'a'; } }
const first13 = new K13().r;
console.log('spread', String(first13), typeof first13, String(probe13()), String(0));
// spread-call
const T14 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'la'; yield 'te'; } } };
let sink14;
function probe14() { const v = T14[sink14.k]; return ((a, b) => a + b)(...v); }
class K14 { constructor() { sink14 = this; this.r = probe14(); this.k = 'a'; } }
const first14 = new K14().r;
console.log('spread-call', String(first14), typeof first14, String(probe14()), String(0));
// destructure-array
const T15 = { a: [1, 2], undefined: 'late' };
let sink15;
function probe15() { const v = T15[sink15.k]; const [a, b] = v; return a + b; }
class K15 { constructor() { sink15 = this; this.r = probe15(); this.k = 'a'; } }
const first15 = new K15().r;
console.log('destructure-array', String(first15), typeof first15, String(probe15()), String(0));
// destructure-object
const T16 = { a: { p: 1 }, undefined: { q: 0, get p() { return 'late'; } } };
let sink16;
function probe16() { const v = T16[sink16.k]; const { p } = v; return p; }
class K16 { constructor() { sink16 = this; this.r = probe16(); this.k = 'a'; } }
const first16 = new K16().r;
console.log('destructure-object', String(first16), typeof first16, String(probe16()), String(0));
// to-primitive
let side17 = 0;
const T17 = { a: 1, undefined: { valueOf() { side17++; return 'late'; } } };
let sink17;
function probe17() { const v = T17[sink17.k]; return v + 1; }
class K17 { constructor() { sink17 = this; this.r = probe17(); this.k = 'a'; } }
const first17 = new K17().r;
console.log('to-primitive', String(first17), typeof first17, String(probe17()), String(side17));
// to-primitive-symbol
const T18 = { a: 1, undefined: { [Symbol.toPrimitive]() { return 'late'; } } };
let sink18;
function probe18() { const v = T18[sink18.k]; return `${v}`; }
class K18 { constructor() { sink18 = this; this.r = probe18(); this.k = 'a'; } }
const first18 = new K18().r;
console.log('to-primitive-symbol', String(first18), typeof first18, String(probe18()), String(0));
// to-string
const T19 = { a: 'e', undefined: { toString() { return 'late'; } } };
let sink19;
function probe19() { const v = T19[sink19.k]; return String(v); }
class K19 { constructor() { sink19 = this; this.r = probe19(); this.k = 'a'; } }
const first19 = new K19().r;
console.log('to-string', String(first19), typeof first19, String(probe19()), String(0));
// to-number
const T20 = { a: 1, undefined: { valueOf() { return 2.5; } } };
let sink20;
function probe20() { const v = T20[sink20.k]; return v * 2; }
class K20 { constructor() { sink20 = this; this.r = probe20(); this.k = 'a'; } }
const first20 = new K20().r;
console.log('to-number', String(first20), typeof first20, String(probe20()), String(0));
// to-json
const T21 = { a: { a: 1 }, undefined: { toJSON() { return 'late'; } } };
let sink21;
function probe21() { const v = T21[sink21.k]; return JSON.stringify(v); }
class K21 { constructor() { sink21 = this; this.r = probe21(); this.k = 'a'; } }
const first21 = new K21().r;
console.log('to-json', String(first21), typeof first21, String(probe21()), String(0));
// to-key
let side22 = 0;
const T22 = { a: 'p', undefined: { toString() { side22++; return 'q'; } } };
let sink22;
function probe22() { const v = T22[sink22.k]; return ({ p: 1, q: 'late' })[v]; }
class K22 { constructor() { sink22 = this; this.r = probe22(); this.k = 'a'; } }
const first22 = new K22().r;
console.log('to-key', String(first22), typeof first22, String(probe22()), String(side22));
// instanceof-right
let side23 = 0;
const T23 = { a: class A23 {}, undefined: { [Symbol.hasInstance]() { side23++; return true; } } };
let sink23;
function probe23() { const v = T23[sink23.k]; return ({}) instanceof v; }
class K23 { constructor() { sink23 = this; this.r = probe23(); this.k = 'a'; } }
const first23 = new K23().r;
console.log('instanceof-right', String(first23), typeof first23, String(probe23()), String(side23));
// instanceof-left
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
let sink24;
function probe24() { const v = T24[sink24.k]; return v instanceof A24; }
class K24 { constructor() { sink24 = this; this.r = probe24(); this.k = 'a'; } }
const first24 = new K24().r;
console.log('instanceof-left', String(first24), typeof first24, String(probe24()), String(0));
// extends
const T25 = { a: class { tag() { return 1; } }, undefined: class { tag() { return 'late'; } } };
let sink25;
function probe25() { const v = T25[sink25.k]; class X extends v {} return new X().tag(); }
class K25 { constructor() { sink25 = this; this.r = probe25(); this.k = 'a'; } }
const first25 = new K25().r;
console.log('extends', String(first25), typeof first25, String(probe25()), String(0));
// extends-constructor
const T26 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.u = 0; this.t = 'late'; } } };
let sink26;
function probe26() { const v = T26[sink26.k]; class X extends v { constructor() { super(); this.z = 3; } } return new X().t; }
class K26 { constructor() { sink26 = this; this.r = probe26(); this.k = 'a'; } }
const first26 = new K26().r;
console.log('extends-constructor', String(first26), typeof first26, String(probe26()), String(0));
// object-create
const T27 = { a: { tag: 1 }, undefined: { get tag() { return 'late'; } } };
let sink27;
function probe27() { const v = T27[sink27.k]; return Object.create(v).tag; }
class K27 { constructor() { sink27 = this; this.r = probe27(); this.k = 'a'; } }
const first27 = new K27().r;
console.log('object-create', String(first27), typeof first27, String(probe27()), String(0));
// set-prototype
const T28 = { a: { tag: 1 }, undefined: { tag: 'late' } };
let sink28;
function probe28() { const v = T28[sink28.k]; const o = {}; Object.setPrototypeOf(o, v); return o.tag; }
class K28 { constructor() { sink28 = this; this.r = probe28(); this.k = 'a'; } }
const first28 = new K28().r;
console.log('set-prototype', String(first28), typeof first28, String(probe28()), String(0));
// proto-literal
const T29 = { a: { tag: 1 }, undefined: { tag: 'late' } };
let sink29;
function probe29() { const v = T29[sink29.k]; return ({ __proto__: v }).tag; }
class K29 { constructor() { sink29 = this; this.r = probe29(); this.k = 'a'; } }
const first29 = new K29().r;
console.log('proto-literal', String(first29), typeof first29, String(probe29()), String(0));
// reflect-get
const T30 = { a: { g: 1 }, undefined: { get g() { return 'late'; } } };
let sink30;
function probe30() { const v = T30[sink30.k]; return Reflect.get(v, 'g'); }
class K30 { constructor() { sink30 = this; this.r = probe30(); this.k = 'a'; } }
const first30 = new K30().r;
console.log('reflect-get', String(first30), typeof first30, String(probe30()), String(0));
// reflect-apply
const T31 = { a: () => 1, undefined: () => 'late' };
let sink31;
function probe31() { const v = T31[sink31.k]; return Reflect.apply(v, null, []); }
class K31 { constructor() { sink31 = this; this.r = probe31(); this.k = 'a'; } }
const first31 = new K31().r;
console.log('reflect-apply', String(first31), typeof first31, String(probe31()), String(0));
// reflect-construct
const T32 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.t = 'late'; } } };
let sink32;
function probe32() { const v = T32[sink32.k]; return Reflect.construct(v, []).t; }
class K32 { constructor() { sink32 = this; this.r = probe32(); this.k = 'a'; } }
const first32 = new K32().r;
console.log('reflect-construct', String(first32), typeof first32, String(probe32()), String(0));
// map-callback
const T33 = { a: x => x, undefined: x => 'late' + x };
let sink33;
function probe33() { const v = T33[sink33.k]; return [1, 2].map(v).join(); }
class K33 { constructor() { sink33 = this; this.r = probe33(); this.k = 'a'; } }
const first33 = new K33().r;
console.log('map-callback', String(first33), typeof first33, String(probe33()), String(0));
// foreach-callback
let side34 = 0;
const T34 = { a: x => {}, undefined: x => { side34 += x; } };
let sink34;
function probe34() { const v = T34[sink34.k]; [1, 2].forEach(v); return 0; }
class K34 { constructor() { sink34 = this; this.r = probe34(); this.k = 'a'; } }
const first34 = new K34().r;
console.log('foreach-callback', String(first34), typeof first34, String(probe34()), String(side34));
// sort-callback
const T35 = { a: (a, b) => a - b, undefined: (a, b) => b - a };
let sink35;
function probe35() { const v = T35[sink35.k]; return [1, 3, 2].sort(v).join(); }
class K35 { constructor() { sink35 = this; this.r = probe35(); this.k = 'a'; } }
const first35 = new K35().r;
console.log('sort-callback', String(first35), typeof first35, String(probe35()), String(0));
// reduce-callback
const T36 = { a: (a, b) => a + b, undefined: (a, b) => a + 's' + b };
let sink36;
function probe36() { const v = T36[sink36.k]; return [1, 2].reduce(v); }
class K36 { constructor() { sink36 = this; this.r = probe36(); this.k = 'a'; } }
const first36 = new K36().r;
console.log('reduce-callback', String(first36), typeof first36, String(probe36()), String(0));
// filter-callback
const T37 = { a: x => true, undefined: x => x > 1 };
let sink37;
function probe37() { const v = T37[sink37.k]; return [1, 2].filter(v).length; }
class K37 { constructor() { sink37 = this; this.r = probe37(); this.k = 'a'; } }
const first37 = new K37().r;
console.log('filter-callback', String(first37), typeof first37, String(probe37()), String(0));
// find-callback
const T38 = { a: x => x == 1, undefined: x => x == 2 };
let sink38;
function probe38() { const v = T38[sink38.k]; return [1, 2].find(v); }
class K38 { constructor() { sink38 = this; this.r = probe38(); this.k = 'a'; } }
const first38 = new K38().r;
console.log('find-callback', String(first38), typeof first38, String(probe38()), String(0));
// array-from-callback
const T39 = { a: x => x, undefined: x => 'late' };
let sink39;
function probe39() { const v = T39[sink39.k]; return Array.from([1], v)[0]; }
class K39 { constructor() { sink39 = this; this.r = probe39(); this.k = 'a'; } }
const first39 = new K39().r;
console.log('array-from-callback', String(first39), typeof first39, String(probe39()), String(0));
