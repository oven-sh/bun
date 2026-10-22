// Each table is read under a key that comes from a field that is read before the constructor stores it: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// throw
const T0 = { a: 1, undefined: { tag: 'late' } };
let sink0;
function probe0() { const v = T0[sink0.k]; try { throw v; } catch (e) { return typeof e === 'number' ? e : e.tag; } }
class K0 { constructor() { sink0 = this; this.r = probe0(); this.k = 'a'; } }
const first0 = new K0().r;
console.log('throw', String(first0), typeof first0, String(probe0()), String(0));
// number-double
const T1 = { a: 1, undefined: 1.5 };
let sink1;
function probe1() { const v = T1[sink1.k]; return v + 1; }
class K1 { constructor() { sink1 = this; this.r = probe1(); this.k = 'a'; } }
const first1 = new K1().r;
console.log('number-double', String(first1), typeof first1, String(probe1()), String(0));
// number-large
const T2 = { a: 1, undefined: 2 ** 40 };
let sink2;
function probe2() { const v = T2[sink2.k]; return v + 1; }
class K2 { constructor() { sink2 = this; this.r = probe2(); this.k = 'a'; } }
const first2 = new K2().r;
console.log('number-large', String(first2), typeof first2, String(probe2()), String(0));
// number-negative-zero
const T3 = { a: 1, undefined: -0 };
let sink3;
function probe3() { const v = T3[sink3.k]; return 1 / v; }
class K3 { constructor() { sink3 = this; this.r = probe3(); this.k = 'a'; } }
const first3 = new K3().r;
console.log('number-negative-zero', String(first3), typeof first3, String(probe3()), String(0));
// number-nan
const T4 = { a: 1, undefined: NaN };
let sink4;
function probe4() { const v = T4[sink4.k]; return v === v; }
class K4 { constructor() { sink4 = this; this.r = probe4(); this.k = 'a'; } }
const first4 = new K4().r;
console.log('number-nan', String(first4), typeof first4, String(probe4()), String(0));
// number-bigint
const T5 = { a: 1, undefined: 1n };
let sink5;
function probe5() { const v = T5[sink5.k]; return typeof (v * v); }
class K5 { constructor() { sink5 = this; this.r = probe5(); this.k = 'a'; } }
const first5 = new K5().r;
console.log('number-bigint', String(first5), typeof first5, String(probe5()), String(0));
// number-string
const T6 = { a: 1, undefined: 's' };
let sink6;
function probe6() { const v = T6[sink6.k]; return v + 1; }
class K6 { constructor() { sink6 = this; this.r = probe6(); this.k = 'a'; } }
const first6 = new K6().r;
console.log('number-string', String(first6), typeof first6, String(probe6()), String(0));
// number-bitor
const T7 = { a: 1, undefined: 2 ** 32 + 5.5 };
let sink7;
function probe7() { const v = T7[sink7.k]; return v | 0; }
class K7 { constructor() { sink7 = this; this.r = probe7(); this.k = 'a'; } }
const first7 = new K7().r;
console.log('number-bitor', String(first7), typeof first7, String(probe7()), String(0));
// number-index
const T8 = { a: 0, undefined: 'length' };
let sink8;
function probe8() { const v = T8[sink8.k]; return [7, 8][v]; }
class K8 { constructor() { sink8 = this; this.r = probe8(); this.k = 'a'; } }
const first8 = new K8().r;
console.log('number-index', String(first8), typeof first8, String(probe8()), String(0));
// number-index-negative
const T9 = { a: 0, undefined: -1 };
let sink9;
function probe9() { const v = T9[sink9.k]; return [7, 8][v]; }
class K9 { constructor() { sink9 = this; this.r = probe9(); this.k = 'a'; } }
const first9 = new K9().r;
console.log('number-index-negative', String(first9), typeof first9, String(probe9()), String(0));
// number-index-far
const T10 = { a: 0, undefined: 5 };
let sink10;
function probe10() { const v = T10[sink10.k]; return [7, 8][v]; }
class K10 { constructor() { sink10 = this; this.r = probe10(); this.k = 'a'; } }
const first10 = new K10().r;
console.log('number-index-far', String(first10), typeof first10, String(probe10()), String(0));
// string-length
const T11 = { a: 'a', undefined: 5 };
let sink11;
function probe11() { const v = T11[sink11.k]; return v.length; }
class K11 { constructor() { sink11 = this; this.r = probe11(); this.k = 'a'; } }
const first11 = new K11().r;
console.log('string-length', String(first11), typeof first11, String(probe11()), String(0));
// string-method
const T12 = { a: 'a', undefined: { charCodeAt() { return 'late'; } } };
let sink12;
function probe12() { const v = T12[sink12.k]; return v.charCodeAt(0); }
class K12 { constructor() { sink12 = this; this.r = probe12(); this.k = 'a'; } }
const first12 = new K12().r;
console.log('string-method', String(first12), typeof first12, String(probe12()), String(0));
// boolean
const T13 = { a: true, undefined: 'late' };
let sink13;
function probe13() { const v = T13[sink13.k]; return v === true; }
class K13 { constructor() { sink13 = this; this.r = probe13(); this.k = 'a'; } }
const first13 = new K13().r;
console.log('boolean', String(first13), typeof first13, String(probe13()), String(0));
// arguments-object
const T14 = { a: () => 1, undefined: () => 'late' };
let sink14;
function probe14() { const v = T14[sink14.k]; return (function () { return arguments[0](); })(v); }
class K14 { constructor() { sink14 = this; this.r = probe14(); this.k = 'a'; } }
const first14 = new K14().r;
console.log('arguments-object', String(first14), typeof first14, String(probe14()), String(0));
// rest
const T15 = { a: () => 1, undefined: () => 'late' };
let sink15;
function probe15() { const v = T15[sink15.k]; return ((...r) => r[0]())(v); }
class K15 { constructor() { sink15 = this; this.r = probe15(); this.k = 'a'; } }
const first15 = new K15().r;
console.log('rest', String(first15), typeof first15, String(probe15()), String(0));
// default-parameter
const T16 = { a: 1, undefined: undefined };
let sink16;
function probe16() { const v = T16[sink16.k]; return ((a = 'late') => a)(v); }
class K16 { constructor() { sink16 = this; this.r = probe16(); this.k = 'a'; } }
const first16 = new K16().r;
console.log('default-parameter', String(first16), typeof first16, String(probe16()), String(0));
// closure-state
let count17 = 0.5;
const T17 = { a: () => 1, undefined: () => ++count17 };
let sink17;
function probe17() { const v = T17[sink17.k]; return v(); }
class K17 { constructor() { sink17 = this; this.r = probe17(); this.k = 'a'; } }
const first17 = new K17().r;
console.log('closure-state', String(first17), typeof first17, String(probe17()), String(count17));
// array-element
const T18 = { a: [() => 1], undefined: [() => 'late'] };
let sink18;
function probe18() { const v = T18[sink18.k]; return v[0](); }
class K18 { constructor() { sink18 = this; this.r = probe18(); this.k = 'a'; } }
const first18 = new K18().r;
console.log('array-element', String(first18), typeof first18, String(probe18()), String(0));
// nested-object
const T19 = { a: { in: { f() { return 1; } } }, undefined: { in: { f() { return 'late'; } } } };
let sink19;
function probe19() { const v = T19[sink19.k]; return v.in.f(); }
class K19 { constructor() { sink19 = this; this.r = probe19(); this.k = 'a'; } }
const first19 = new K19().r;
console.log('nested-object', String(first19), typeof first19, String(probe19()), String(0));
// map-value
const T20 = { a: new Map([['k', () => 1]]), undefined: new Map([['k', () => 'late']]) };
let sink20;
function probe20() { const v = T20[sink20.k]; return v.get('k')(); }
class K20 { constructor() { sink20 = this; this.r = probe20(); this.k = 'a'; } }
const first20 = new K20().r;
console.log('map-value', String(first20), typeof first20, String(probe20()), String(0));
// symbol-key
const sym21 = Symbol();
const T21 = { a: { [sym21]: 1 }, undefined: { [sym21]: 'late' } };
let sink21;
function probe21() { const v = T21[sink21.k]; return v[sym21]; }
class K21 { constructor() { sink21 = this; this.r = probe21(); this.k = 'a'; } }
const first21 = new K21().r;
console.log('symbol-key', String(first21), typeof first21, String(probe21()), String(0));
// private-field
class A22 { #p; constructor(p) { this.#p = p; } static read(o) { return o.#p; } }
const T22 = { a: new A22(1), undefined: new A22('late') };
let sink22;
function probe22() { const v = T22[sink22.k]; return A22.read(v); }
class K22 { constructor() { sink22 = this; this.r = probe22(); this.k = 'a'; } }
const first22 = new K22().r;
console.log('private-field', String(first22), typeof first22, String(probe22()), String(0));
// private-in
class A23 { #p = 1; static has(o) { return #p in o; } }
const T23 = { a: new A23(), undefined: {} };
let sink23;
function probe23() { const v = T23[sink23.k]; return A23.has(v); }
class K23 { constructor() { sink23 = this; this.r = probe23(); this.k = 'a'; } }
const first23 = new K23().r;
console.log('private-in', String(first23), typeof first23, String(probe23()), String(0));
// regexp
const T24 = { a: /a/, undefined: { exec() { return null; }, test() { return 'late'; } } };
let sink24;
function probe24() { const v = T24[sink24.k]; return v.test('a'); }
class K24 { constructor() { sink24 = this; this.r = probe24(); this.k = 'a'; } }
const first24 = new K24().r;
console.log('regexp', String(first24), typeof first24, String(probe24()), String(0));
// date
const T25 = { a: new Date(0), undefined: { getTime() { return 'late'; } } };
let sink25;
function probe25() { const v = T25[sink25.k]; return v.getTime(); }
class K25 { constructor() { sink25 = this; this.r = probe25(); this.k = 'a'; } }
const first25 = new K25().r;
console.log('date', String(first25), typeof first25, String(probe25()), String(0));
// typed-array
const T26 = { a: new Uint8Array([1]), undefined: new Float64Array([1.5]) };
let sink26;
function probe26() { const v = T26[sink26.k]; return v[0] + 1; }
class K26 { constructor() { sink26 = this; this.r = probe26(); this.k = 'a'; } }
const first26 = new K26().r;
console.log('typed-array', String(first26), typeof first26, String(probe26()), String(0));
// typed-array-or-array
const T27 = { a: new Uint8Array([1]), undefined: ['late'] };
let sink27;
function probe27() { const v = T27[sink27.k]; return v[0]; }
class K27 { constructor() { sink27 = this; this.r = probe27(); this.k = 'a'; } }
const first27 = new K27().r;
console.log('typed-array-or-array', String(first27), typeof first27, String(probe27()), String(0));
// array-holes
const T28 = { a: [1, 2], undefined: [, 2] };
let sink28;
function probe28() { const v = T28[sink28.k]; return v[0]; }
class K28 { constructor() { sink28 = this; this.r = probe28(); this.k = 'a'; } }
const first28 = new K28().r;
console.log('array-holes', String(first28), typeof first28, String(probe28()), String(0));
// array-doubles
const T29 = { a: [1, 2], undefined: [1.5, 2] };
let sink29;
function probe29() { const v = T29[sink29.k]; return v[0] + 1; }
class K29 { constructor() { sink29 = this; this.r = probe29(); this.k = 'a'; } }
const first29 = new K29().r;
console.log('array-doubles', String(first29), typeof first29, String(probe29()), String(0));
// array-length
const T30 = { a: [1, 2], undefined: { length: 'late' } };
let sink30;
function probe30() { const v = T30[sink30.k]; return v.length; }
class K30 { constructor() { sink30 = this; this.r = probe30(); this.k = 'a'; } }
const first30 = new K30().r;
console.log('array-length', String(first30), typeof first30, String(probe30()), String(0));
// second-level-leak
let innerSink31, inner31 = 'none'; class Inner31 { constructor() { innerSink31 = this; inner31 = typeof innerSink31.f; this.f = 1; } }
const T31 = { a: () => 1, undefined: () => { new Inner31(); return inner31; } };
let sink31;
function probe31() { const v = T31[sink31.k]; return v(); }
class K31 { constructor() { sink31 = this; this.r = probe31(); this.k = 'a'; } }
const first31 = new K31().r;
console.log('second-level-leak', String(first31), typeof first31, String(probe31()), String(typeof innerSink31.f));
// second-level-variable
const T32 = { a: () => 1, undefined: () => typeof laterVariable32 };
let sink32;
function probe32() { const v = T32[sink32.k]; return v(); }
class K32 { constructor() { sink32 = this; this.r = probe32(); this.k = 'a'; } }
const first32 = new K32().r;
var laterVariable32 = 1;
console.log('second-level-variable', String(first32), typeof first32, String(probe32()), String(typeof laterVariable32));
