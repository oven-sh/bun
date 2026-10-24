// Each table is read under a key that comes from a static field that is read before it is defined: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// call
const T0 = { a: () => 1, undefined: () => 'late' };
function probe0(c) { const v = T0[c.k]; return v(); }
class S0 { static r = probe0(this); static k = 'a'; }
const first0 = S0.r;
console.log('call', String(first0), typeof first0, String(probe0(S0)), String(0));
// call-writes-variable
let once1 = 1;
const T1 = { a: () => 1, undefined: () => { once1 = 2; return 0; } };
function probe1(c) { const v = T1[c.k]; return v(); }
class S1 { static r = probe1(this); static k = 'a'; }
const first1 = S1.r;
console.log('call-writes-variable', String(first1), typeof first1, String(probe1(S1)), String(once1 + 1));
// call-argument
const T2 = { a: x => x + 1, undefined: x => x + 's' };
function probe2(c) { const v = T2[c.k]; return v(1); }
class S2 { static r = probe2(this); static k = 'a'; }
const first2 = S2.r;
console.log('call-argument', String(first2), typeof first2, String(probe2(S2)), String(0));
// new
const T3 = { a: class { constructor() { this.tag = 1; } }, undefined: class { constructor() { this.other = 0; this.tag = 'late'; } } };
function probe3(c) { const v = T3[c.k]; return new v().tag; }
class S3 { static r = probe3(this); static k = 'a'; }
const first3 = S3.r;
console.log('new', String(first3), typeof first3, String(probe3(S3)), String(0));
// method
const T4 = { a: { m() { return 1; } }, undefined: { z: 0, m() { return 'late'; } } };
function probe4(c) { const v = T4[c.k]; return v.m(); }
class S4 { static r = probe4(this); static k = 'a'; }
const first4 = S4.r;
console.log('method', String(first4), typeof first4, String(probe4(S4)), String(0));
// getter
let side5 = 0;
const T5 = { a: { g: 1 }, undefined: { get g() { side5++; return 'late'; } } };
function probe5(c) { const v = T5[c.k]; return v.g; }
class S5 { static r = probe5(this); static k = 'a'; }
const first5 = S5.r;
console.log('getter', String(first5), typeof first5, String(probe5(S5)), String(side5));
// setter
let side6 = 0;
const T6 = { a: { s: 1 }, undefined: { set s(x) { side6 = x; } } };
function probe6(c) { const v = T6[c.k]; v.s = 5; return 0; }
class S6 { static r = probe6(this); static k = 'a'; }
const first6 = S6.r;
console.log('setter', String(first6), typeof first6, String(probe6(S6)), String(side6 + 1));
// slot
const T7 = { a: { x: 1 }, undefined: { y: 0, w: 2, x: 'late' } };
function probe7(c) { const v = T7[c.k]; return v.x; }
class S7 { static r = probe7(this); static k = 'a'; }
const first7 = S7.r;
console.log('slot', String(first7), typeof first7, String(probe7(S7)), String(0));
// slot-number
const T8 = { a: { x: 1 }, undefined: { y: 0, x: 1.5 } };
function probe8(c) { const v = T8[c.k]; return v.x + 1; }
class S8 { static r = probe8(this); static k = 'a'; }
const first8 = S8.r;
console.log('slot-number', String(first8), typeof first8, String(probe8(S8)), String(0));
// for-of
const T9 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function probe9(c) { const v = T9[c.k]; let r = ''; for (const x of v) r += x; return r; }
class S9 { static r = probe9(this); static k = 'a'; }
const first9 = S9.r;
console.log('for-of', String(first9), typeof first9, String(probe9(S9)), String(0));
// for-of-set
const T10 = { a: [1, 2], undefined: new Set(['late']) };
function probe10(c) { const v = T10[c.k]; let r = ''; for (const x of v) r += x; return r; }
class S10 { static r = probe10(this); static k = 'a'; }
const first10 = S10.r;
console.log('for-of-set', String(first10), typeof first10, String(probe10(S10)), String(0));
// for-of-string
const T11 = { a: [1, 2], undefined: 'late' };
function probe11(c) { const v = T11[c.k]; let r = ''; for (const x of v) r += x + '.'; return r; }
class S11 { static r = probe11(this); static k = 'a'; }
const first11 = S11.r;
console.log('for-of-string', String(first11), typeof first11, String(probe11(S11)), String(0));
// for-of-return
let side12 = 0;
const T12 = { a: [1, 2], undefined: { [Symbol.iterator]() { return { next() { return { done: false, value: 'late' }; }, return() { side12++; return {}; } }; } } };
function probe12(c) { const v = T12[c.k]; for (const x of v) return x; }
class S12 { static r = probe12(this); static k = 'a'; }
const first12 = S12.r;
console.log('for-of-return', String(first12), typeof first12, String(probe12(S12)), String(side12));
// spread
const T13 = { a: [1, 2], undefined: new Set(['late']) };
function probe13(c) { const v = T13[c.k]; return [...v].join(); }
class S13 { static r = probe13(this); static k = 'a'; }
const first13 = S13.r;
console.log('spread', String(first13), typeof first13, String(probe13(S13)), String(0));
// spread-call
const T14 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'la'; yield 'te'; } } };
function probe14(c) { const v = T14[c.k]; return ((a, b) => a + b)(...v); }
class S14 { static r = probe14(this); static k = 'a'; }
const first14 = S14.r;
console.log('spread-call', String(first14), typeof first14, String(probe14(S14)), String(0));
// destructure-array
const T15 = { a: [1, 2], undefined: 'late' };
function probe15(c) { const v = T15[c.k]; const [a, b] = v; return a + b; }
class S15 { static r = probe15(this); static k = 'a'; }
const first15 = S15.r;
console.log('destructure-array', String(first15), typeof first15, String(probe15(S15)), String(0));
// destructure-object
const T16 = { a: { p: 1 }, undefined: { q: 0, get p() { return 'late'; } } };
function probe16(c) { const v = T16[c.k]; const { p } = v; return p; }
class S16 { static r = probe16(this); static k = 'a'; }
const first16 = S16.r;
console.log('destructure-object', String(first16), typeof first16, String(probe16(S16)), String(0));
// to-primitive
let side17 = 0;
const T17 = { a: 1, undefined: { valueOf() { side17++; return 'late'; } } };
function probe17(c) { const v = T17[c.k]; return v + 1; }
class S17 { static r = probe17(this); static k = 'a'; }
const first17 = S17.r;
console.log('to-primitive', String(first17), typeof first17, String(probe17(S17)), String(side17));
// to-primitive-symbol
const T18 = { a: 1, undefined: { [Symbol.toPrimitive]() { return 'late'; } } };
function probe18(c) { const v = T18[c.k]; return `${v}`; }
class S18 { static r = probe18(this); static k = 'a'; }
const first18 = S18.r;
console.log('to-primitive-symbol', String(first18), typeof first18, String(probe18(S18)), String(0));
// to-string
const T19 = { a: 'e', undefined: { toString() { return 'late'; } } };
function probe19(c) { const v = T19[c.k]; return String(v); }
class S19 { static r = probe19(this); static k = 'a'; }
const first19 = S19.r;
console.log('to-string', String(first19), typeof first19, String(probe19(S19)), String(0));
// to-number
const T20 = { a: 1, undefined: { valueOf() { return 2.5; } } };
function probe20(c) { const v = T20[c.k]; return v * 2; }
class S20 { static r = probe20(this); static k = 'a'; }
const first20 = S20.r;
console.log('to-number', String(first20), typeof first20, String(probe20(S20)), String(0));
// to-json
const T21 = { a: { a: 1 }, undefined: { toJSON() { return 'late'; } } };
function probe21(c) { const v = T21[c.k]; return JSON.stringify(v); }
class S21 { static r = probe21(this); static k = 'a'; }
const first21 = S21.r;
console.log('to-json', String(first21), typeof first21, String(probe21(S21)), String(0));
// to-key
let side22 = 0;
const T22 = { a: 'p', undefined: { toString() { side22++; return 'q'; } } };
function probe22(c) { const v = T22[c.k]; return ({ p: 1, q: 'late' })[v]; }
class S22 { static r = probe22(this); static k = 'a'; }
const first22 = S22.r;
console.log('to-key', String(first22), typeof first22, String(probe22(S22)), String(side22));
// instanceof-right
let side23 = 0;
const T23 = { a: class A23 {}, undefined: { [Symbol.hasInstance]() { side23++; return true; } } };
function probe23(c) { const v = T23[c.k]; return ({}) instanceof v; }
class S23 { static r = probe23(this); static k = 'a'; }
const first23 = S23.r;
console.log('instanceof-right', String(first23), typeof first23, String(probe23(S23)), String(side23));
// instanceof-left
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function probe24(c) { const v = T24[c.k]; return v instanceof A24; }
class S24 { static r = probe24(this); static k = 'a'; }
const first24 = S24.r;
console.log('instanceof-left', String(first24), typeof first24, String(probe24(S24)), String(0));
// extends
const T25 = { a: class { tag() { return 1; } }, undefined: class { tag() { return 'late'; } } };
function probe25(c) { const v = T25[c.k]; class X extends v {} return new X().tag(); }
class S25 { static r = probe25(this); static k = 'a'; }
const first25 = S25.r;
console.log('extends', String(first25), typeof first25, String(probe25(S25)), String(0));
// extends-constructor
const T26 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.u = 0; this.t = 'late'; } } };
function probe26(c) { const v = T26[c.k]; class X extends v { constructor() { super(); this.z = 3; } } return new X().t; }
class S26 { static r = probe26(this); static k = 'a'; }
const first26 = S26.r;
console.log('extends-constructor', String(first26), typeof first26, String(probe26(S26)), String(0));
// object-create
const T27 = { a: { tag: 1 }, undefined: { get tag() { return 'late'; } } };
function probe27(c) { const v = T27[c.k]; return Object.create(v).tag; }
class S27 { static r = probe27(this); static k = 'a'; }
const first27 = S27.r;
console.log('object-create', String(first27), typeof first27, String(probe27(S27)), String(0));
// set-prototype
const T28 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function probe28(c) { const v = T28[c.k]; const o = {}; Object.setPrototypeOf(o, v); return o.tag; }
class S28 { static r = probe28(this); static k = 'a'; }
const first28 = S28.r;
console.log('set-prototype', String(first28), typeof first28, String(probe28(S28)), String(0));
// proto-literal
const T29 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function probe29(c) { const v = T29[c.k]; return ({ __proto__: v }).tag; }
class S29 { static r = probe29(this); static k = 'a'; }
const first29 = S29.r;
console.log('proto-literal', String(first29), typeof first29, String(probe29(S29)), String(0));
// reflect-get
const T30 = { a: { g: 1 }, undefined: { get g() { return 'late'; } } };
function probe30(c) { const v = T30[c.k]; return Reflect.get(v, 'g'); }
class S30 { static r = probe30(this); static k = 'a'; }
const first30 = S30.r;
console.log('reflect-get', String(first30), typeof first30, String(probe30(S30)), String(0));
// reflect-apply
const T31 = { a: () => 1, undefined: () => 'late' };
function probe31(c) { const v = T31[c.k]; return Reflect.apply(v, null, []); }
class S31 { static r = probe31(this); static k = 'a'; }
const first31 = S31.r;
console.log('reflect-apply', String(first31), typeof first31, String(probe31(S31)), String(0));
// reflect-construct
const T32 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.t = 'late'; } } };
function probe32(c) { const v = T32[c.k]; return Reflect.construct(v, []).t; }
class S32 { static r = probe32(this); static k = 'a'; }
const first32 = S32.r;
console.log('reflect-construct', String(first32), typeof first32, String(probe32(S32)), String(0));
// map-callback
const T33 = { a: x => x, undefined: x => 'late' + x };
function probe33(c) { const v = T33[c.k]; return [1, 2].map(v).join(); }
class S33 { static r = probe33(this); static k = 'a'; }
const first33 = S33.r;
console.log('map-callback', String(first33), typeof first33, String(probe33(S33)), String(0));
// foreach-callback
let side34 = 0;
const T34 = { a: x => {}, undefined: x => { side34 += x; } };
function probe34(c) { const v = T34[c.k]; [1, 2].forEach(v); return 0; }
class S34 { static r = probe34(this); static k = 'a'; }
const first34 = S34.r;
console.log('foreach-callback', String(first34), typeof first34, String(probe34(S34)), String(side34));
// sort-callback
const T35 = { a: (a, b) => a - b, undefined: (a, b) => b - a };
function probe35(c) { const v = T35[c.k]; return [1, 3, 2].sort(v).join(); }
class S35 { static r = probe35(this); static k = 'a'; }
const first35 = S35.r;
console.log('sort-callback', String(first35), typeof first35, String(probe35(S35)), String(0));
// reduce-callback
const T36 = { a: (a, b) => a + b, undefined: (a, b) => a + 's' + b };
function probe36(c) { const v = T36[c.k]; return [1, 2].reduce(v); }
class S36 { static r = probe36(this); static k = 'a'; }
const first36 = S36.r;
console.log('reduce-callback', String(first36), typeof first36, String(probe36(S36)), String(0));
// filter-callback
const T37 = { a: x => true, undefined: x => x > 1 };
function probe37(c) { const v = T37[c.k]; return [1, 2].filter(v).length; }
class S37 { static r = probe37(this); static k = 'a'; }
const first37 = S37.r;
console.log('filter-callback', String(first37), typeof first37, String(probe37(S37)), String(0));
// find-callback
const T38 = { a: x => x == 1, undefined: x => x == 2 };
function probe38(c) { const v = T38[c.k]; return [1, 2].find(v); }
class S38 { static r = probe38(this); static k = 'a'; }
const first38 = S38.r;
console.log('find-callback', String(first38), typeof first38, String(probe38(S38)), String(0));
// array-from-callback
const T39 = { a: x => x, undefined: x => 'late' };
function probe39(c) { const v = T39[c.k]; return Array.from([1], v)[0]; }
class S39 { static r = probe39(this); static k = 'a'; }
const first39 = S39.r;
console.log('array-from-callback', String(first39), typeof first39, String(probe39(S39)), String(0));
