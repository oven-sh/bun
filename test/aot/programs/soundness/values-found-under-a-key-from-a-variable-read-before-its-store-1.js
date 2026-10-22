// Each table is read under a key that comes from a variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// call
const T0 = { a: () => 1, undefined: () => 'late' };
function probe0() { const v = T0[k0]; return v(); }
const first0 = probe0();
var k0 = 'a';
console.log('call', String(first0), typeof first0, String(probe0()), String(0));
// call-writes-variable
let once1 = 1;
const T1 = { a: () => 1, undefined: () => { once1 = 2; return 0; } };
function probe1() { const v = T1[k1]; return v(); }
const first1 = probe1();
var k1 = 'a';
console.log('call-writes-variable', String(first1), typeof first1, String(probe1()), String(once1 + 1));
// call-argument
const T2 = { a: x => x + 1, undefined: x => x + 's' };
function probe2() { const v = T2[k2]; return v(1); }
const first2 = probe2();
var k2 = 'a';
console.log('call-argument', String(first2), typeof first2, String(probe2()), String(0));
// new
const T3 = { a: class { constructor() { this.tag = 1; } }, undefined: class { constructor() { this.other = 0; this.tag = 'late'; } } };
function probe3() { const v = T3[k3]; return new v().tag; }
const first3 = probe3();
var k3 = 'a';
console.log('new', String(first3), typeof first3, String(probe3()), String(0));
// method
const T4 = { a: { m() { return 1; } }, undefined: { z: 0, m() { return 'late'; } } };
function probe4() { const v = T4[k4]; return v.m(); }
const first4 = probe4();
var k4 = 'a';
console.log('method', String(first4), typeof first4, String(probe4()), String(0));
// getter
let side5 = 0;
const T5 = { a: { g: 1 }, undefined: { get g() { side5++; return 'late'; } } };
function probe5() { const v = T5[k5]; return v.g; }
const first5 = probe5();
var k5 = 'a';
console.log('getter', String(first5), typeof first5, String(probe5()), String(side5));
// setter
let side6 = 0;
const T6 = { a: { s: 1 }, undefined: { set s(x) { side6 = x; } } };
function probe6() { const v = T6[k6]; v.s = 5; return 0; }
const first6 = probe6();
var k6 = 'a';
console.log('setter', String(first6), typeof first6, String(probe6()), String(side6 + 1));
// slot
const T7 = { a: { x: 1 }, undefined: { y: 0, w: 2, x: 'late' } };
function probe7() { const v = T7[k7]; return v.x; }
const first7 = probe7();
var k7 = 'a';
console.log('slot', String(first7), typeof first7, String(probe7()), String(0));
// slot-number
const T8 = { a: { x: 1 }, undefined: { y: 0, x: 1.5 } };
function probe8() { const v = T8[k8]; return v.x + 1; }
const first8 = probe8();
var k8 = 'a';
console.log('slot-number', String(first8), typeof first8, String(probe8()), String(0));
// for-of
const T9 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function probe9() { const v = T9[k9]; let r = ''; for (const x of v) r += x; return r; }
const first9 = probe9();
var k9 = 'a';
console.log('for-of', String(first9), typeof first9, String(probe9()), String(0));
// for-of-set
const T10 = { a: [1, 2], undefined: new Set(['late']) };
function probe10() { const v = T10[k10]; let r = ''; for (const x of v) r += x; return r; }
const first10 = probe10();
var k10 = 'a';
console.log('for-of-set', String(first10), typeof first10, String(probe10()), String(0));
// for-of-string
const T11 = { a: [1, 2], undefined: 'late' };
function probe11() { const v = T11[k11]; let r = ''; for (const x of v) r += x + '.'; return r; }
const first11 = probe11();
var k11 = 'a';
console.log('for-of-string', String(first11), typeof first11, String(probe11()), String(0));
// for-of-return
let side12 = 0;
const T12 = { a: [1, 2], undefined: { [Symbol.iterator]() { return { next() { return { done: false, value: 'late' }; }, return() { side12++; return {}; } }; } } };
function probe12() { const v = T12[k12]; for (const x of v) return x; }
const first12 = probe12();
var k12 = 'a';
console.log('for-of-return', String(first12), typeof first12, String(probe12()), String(side12));
// spread
const T13 = { a: [1, 2], undefined: new Set(['late']) };
function probe13() { const v = T13[k13]; return [...v].join(); }
const first13 = probe13();
var k13 = 'a';
console.log('spread', String(first13), typeof first13, String(probe13()), String(0));
// spread-call
const T14 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'la'; yield 'te'; } } };
function probe14() { const v = T14[k14]; return ((a, b) => a + b)(...v); }
const first14 = probe14();
var k14 = 'a';
console.log('spread-call', String(first14), typeof first14, String(probe14()), String(0));
// destructure-array
const T15 = { a: [1, 2], undefined: 'late' };
function probe15() { const v = T15[k15]; const [a, b] = v; return a + b; }
const first15 = probe15();
var k15 = 'a';
console.log('destructure-array', String(first15), typeof first15, String(probe15()), String(0));
// destructure-object
const T16 = { a: { p: 1 }, undefined: { q: 0, get p() { return 'late'; } } };
function probe16() { const v = T16[k16]; const { p } = v; return p; }
const first16 = probe16();
var k16 = 'a';
console.log('destructure-object', String(first16), typeof first16, String(probe16()), String(0));
// to-primitive
let side17 = 0;
const T17 = { a: 1, undefined: { valueOf() { side17++; return 'late'; } } };
function probe17() { const v = T17[k17]; return v + 1; }
const first17 = probe17();
var k17 = 'a';
console.log('to-primitive', String(first17), typeof first17, String(probe17()), String(side17));
// to-primitive-symbol
const T18 = { a: 1, undefined: { [Symbol.toPrimitive]() { return 'late'; } } };
function probe18() { const v = T18[k18]; return `${v}`; }
const first18 = probe18();
var k18 = 'a';
console.log('to-primitive-symbol', String(first18), typeof first18, String(probe18()), String(0));
// to-string
const T19 = { a: 'e', undefined: { toString() { return 'late'; } } };
function probe19() { const v = T19[k19]; return String(v); }
const first19 = probe19();
var k19 = 'a';
console.log('to-string', String(first19), typeof first19, String(probe19()), String(0));
// to-number
const T20 = { a: 1, undefined: { valueOf() { return 2.5; } } };
function probe20() { const v = T20[k20]; return v * 2; }
const first20 = probe20();
var k20 = 'a';
console.log('to-number', String(first20), typeof first20, String(probe20()), String(0));
// to-json
const T21 = { a: { a: 1 }, undefined: { toJSON() { return 'late'; } } };
function probe21() { const v = T21[k21]; return JSON.stringify(v); }
const first21 = probe21();
var k21 = 'a';
console.log('to-json', String(first21), typeof first21, String(probe21()), String(0));
// to-key
let side22 = 0;
const T22 = { a: 'p', undefined: { toString() { side22++; return 'q'; } } };
function probe22() { const v = T22[k22]; return ({ p: 1, q: 'late' })[v]; }
const first22 = probe22();
var k22 = 'a';
console.log('to-key', String(first22), typeof first22, String(probe22()), String(side22));
// instanceof-right
let side23 = 0;
const T23 = { a: class A23 {}, undefined: { [Symbol.hasInstance]() { side23++; return true; } } };
function probe23() { const v = T23[k23]; return ({}) instanceof v; }
const first23 = probe23();
var k23 = 'a';
console.log('instanceof-right', String(first23), typeof first23, String(probe23()), String(side23));
// instanceof-left
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function probe24() { const v = T24[k24]; return v instanceof A24; }
const first24 = probe24();
var k24 = 'a';
console.log('instanceof-left', String(first24), typeof first24, String(probe24()), String(0));
// extends
const T25 = { a: class { tag() { return 1; } }, undefined: class { tag() { return 'late'; } } };
function probe25() { const v = T25[k25]; class X extends v {} return new X().tag(); }
const first25 = probe25();
var k25 = 'a';
console.log('extends', String(first25), typeof first25, String(probe25()), String(0));
// extends-constructor
const T26 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.u = 0; this.t = 'late'; } } };
function probe26() { const v = T26[k26]; class X extends v { constructor() { super(); this.z = 3; } } return new X().t; }
const first26 = probe26();
var k26 = 'a';
console.log('extends-constructor', String(first26), typeof first26, String(probe26()), String(0));
// object-create
const T27 = { a: { tag: 1 }, undefined: { get tag() { return 'late'; } } };
function probe27() { const v = T27[k27]; return Object.create(v).tag; }
const first27 = probe27();
var k27 = 'a';
console.log('object-create', String(first27), typeof first27, String(probe27()), String(0));
// set-prototype
const T28 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function probe28() { const v = T28[k28]; const o = {}; Object.setPrototypeOf(o, v); return o.tag; }
const first28 = probe28();
var k28 = 'a';
console.log('set-prototype', String(first28), typeof first28, String(probe28()), String(0));
// proto-literal
const T29 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function probe29() { const v = T29[k29]; return ({ __proto__: v }).tag; }
const first29 = probe29();
var k29 = 'a';
console.log('proto-literal', String(first29), typeof first29, String(probe29()), String(0));
// reflect-get
const T30 = { a: { g: 1 }, undefined: { get g() { return 'late'; } } };
function probe30() { const v = T30[k30]; return Reflect.get(v, 'g'); }
const first30 = probe30();
var k30 = 'a';
console.log('reflect-get', String(first30), typeof first30, String(probe30()), String(0));
// reflect-apply
const T31 = { a: () => 1, undefined: () => 'late' };
function probe31() { const v = T31[k31]; return Reflect.apply(v, null, []); }
const first31 = probe31();
var k31 = 'a';
console.log('reflect-apply', String(first31), typeof first31, String(probe31()), String(0));
// reflect-construct
const T32 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.t = 'late'; } } };
function probe32() { const v = T32[k32]; return Reflect.construct(v, []).t; }
const first32 = probe32();
var k32 = 'a';
console.log('reflect-construct', String(first32), typeof first32, String(probe32()), String(0));
// map-callback
const T33 = { a: x => x, undefined: x => 'late' + x };
function probe33() { const v = T33[k33]; return [1, 2].map(v).join(); }
const first33 = probe33();
var k33 = 'a';
console.log('map-callback', String(first33), typeof first33, String(probe33()), String(0));
// foreach-callback
let side34 = 0;
const T34 = { a: x => {}, undefined: x => { side34 += x; } };
function probe34() { const v = T34[k34]; [1, 2].forEach(v); return 0; }
const first34 = probe34();
var k34 = 'a';
console.log('foreach-callback', String(first34), typeof first34, String(probe34()), String(side34));
// sort-callback
const T35 = { a: (a, b) => a - b, undefined: (a, b) => b - a };
function probe35() { const v = T35[k35]; return [1, 3, 2].sort(v).join(); }
const first35 = probe35();
var k35 = 'a';
console.log('sort-callback', String(first35), typeof first35, String(probe35()), String(0));
// reduce-callback
const T36 = { a: (a, b) => a + b, undefined: (a, b) => a + 's' + b };
function probe36() { const v = T36[k36]; return [1, 2].reduce(v); }
const first36 = probe36();
var k36 = 'a';
console.log('reduce-callback', String(first36), typeof first36, String(probe36()), String(0));
// filter-callback
const T37 = { a: x => true, undefined: x => x > 1 };
function probe37() { const v = T37[k37]; return [1, 2].filter(v).length; }
const first37 = probe37();
var k37 = 'a';
console.log('filter-callback', String(first37), typeof first37, String(probe37()), String(0));
// find-callback
const T38 = { a: x => x == 1, undefined: x => x == 2 };
function probe38() { const v = T38[k38]; return [1, 2].find(v); }
const first38 = probe38();
var k38 = 'a';
console.log('find-callback', String(first38), typeof first38, String(probe38()), String(0));
// array-from-callback
const T39 = { a: x => x, undefined: x => 'late' };
function probe39() { const v = T39[k39]; return Array.from([1], v)[0]; }
const first39 = probe39();
var k39 = 'a';
console.log('array-from-callback', String(first39), typeof first39, String(probe39()), String(0));
