// Each table is read under a key that comes from a variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// throw
const T0 = { a: 1, undefined: { tag: 'late' } };
function probe0() { const v = T0[k0]; try { throw v; } catch (e) { return typeof e === 'number' ? e : e.tag; } }
const first0 = probe0();
var k0 = 'a';
console.log('throw', String(first0), typeof first0, String(probe0()), String(0));
// number-double
const T1 = { a: 1, undefined: 1.5 };
function probe1() { const v = T1[k1]; return v + 1; }
const first1 = probe1();
var k1 = 'a';
console.log('number-double', String(first1), typeof first1, String(probe1()), String(0));
// number-large
const T2 = { a: 1, undefined: 2 ** 40 };
function probe2() { const v = T2[k2]; return v + 1; }
const first2 = probe2();
var k2 = 'a';
console.log('number-large', String(first2), typeof first2, String(probe2()), String(0));
// number-negative-zero
const T3 = { a: 1, undefined: -0 };
function probe3() { const v = T3[k3]; return 1 / v; }
const first3 = probe3();
var k3 = 'a';
console.log('number-negative-zero', String(first3), typeof first3, String(probe3()), String(0));
// number-nan
const T4 = { a: 1, undefined: NaN };
function probe4() { const v = T4[k4]; return v === v; }
const first4 = probe4();
var k4 = 'a';
console.log('number-nan', String(first4), typeof first4, String(probe4()), String(0));
// number-bigint
const T5 = { a: 1, undefined: 1n };
function probe5() { const v = T5[k5]; return typeof (v * v); }
const first5 = probe5();
var k5 = 'a';
console.log('number-bigint', String(first5), typeof first5, String(probe5()), String(0));
// number-string
const T6 = { a: 1, undefined: 's' };
function probe6() { const v = T6[k6]; return v + 1; }
const first6 = probe6();
var k6 = 'a';
console.log('number-string', String(first6), typeof first6, String(probe6()), String(0));
// number-bitor
const T7 = { a: 1, undefined: 2 ** 32 + 5.5 };
function probe7() { const v = T7[k7]; return v | 0; }
const first7 = probe7();
var k7 = 'a';
console.log('number-bitor', String(first7), typeof first7, String(probe7()), String(0));
// number-index
const T8 = { a: 0, undefined: 'length' };
function probe8() { const v = T8[k8]; return [7, 8][v]; }
const first8 = probe8();
var k8 = 'a';
console.log('number-index', String(first8), typeof first8, String(probe8()), String(0));
// number-index-negative
const T9 = { a: 0, undefined: -1 };
function probe9() { const v = T9[k9]; return [7, 8][v]; }
const first9 = probe9();
var k9 = 'a';
console.log('number-index-negative', String(first9), typeof first9, String(probe9()), String(0));
// number-index-far
const T10 = { a: 0, undefined: 5 };
function probe10() { const v = T10[k10]; return [7, 8][v]; }
const first10 = probe10();
var k10 = 'a';
console.log('number-index-far', String(first10), typeof first10, String(probe10()), String(0));
// string-length
const T11 = { a: 'a', undefined: 5 };
function probe11() { const v = T11[k11]; return v.length; }
const first11 = probe11();
var k11 = 'a';
console.log('string-length', String(first11), typeof first11, String(probe11()), String(0));
// string-method
const T12 = { a: 'a', undefined: { charCodeAt() { return 'late'; } } };
function probe12() { const v = T12[k12]; return v.charCodeAt(0); }
const first12 = probe12();
var k12 = 'a';
console.log('string-method', String(first12), typeof first12, String(probe12()), String(0));
// boolean
const T13 = { a: true, undefined: 'late' };
function probe13() { const v = T13[k13]; return v === true; }
const first13 = probe13();
var k13 = 'a';
console.log('boolean', String(first13), typeof first13, String(probe13()), String(0));
// arguments-object
const T14 = { a: () => 1, undefined: () => 'late' };
function probe14() { const v = T14[k14]; return (function () { return arguments[0](); })(v); }
const first14 = probe14();
var k14 = 'a';
console.log('arguments-object', String(first14), typeof first14, String(probe14()), String(0));
// rest
const T15 = { a: () => 1, undefined: () => 'late' };
function probe15() { const v = T15[k15]; return ((...r) => r[0]())(v); }
const first15 = probe15();
var k15 = 'a';
console.log('rest', String(first15), typeof first15, String(probe15()), String(0));
// default-parameter
const T16 = { a: 1, undefined: undefined };
function probe16() { const v = T16[k16]; return ((a = 'late') => a)(v); }
const first16 = probe16();
var k16 = 'a';
console.log('default-parameter', String(first16), typeof first16, String(probe16()), String(0));
// closure-state
let count17 = 0.5;
const T17 = { a: () => 1, undefined: () => ++count17 };
function probe17() { const v = T17[k17]; return v(); }
const first17 = probe17();
var k17 = 'a';
console.log('closure-state', String(first17), typeof first17, String(probe17()), String(count17));
// array-element
const T18 = { a: [() => 1], undefined: [() => 'late'] };
function probe18() { const v = T18[k18]; return v[0](); }
const first18 = probe18();
var k18 = 'a';
console.log('array-element', String(first18), typeof first18, String(probe18()), String(0));
// nested-object
const T19 = { a: { in: { f() { return 1; } } }, undefined: { in: { f() { return 'late'; } } } };
function probe19() { const v = T19[k19]; return v.in.f(); }
const first19 = probe19();
var k19 = 'a';
console.log('nested-object', String(first19), typeof first19, String(probe19()), String(0));
// map-value
const T20 = { a: new Map([['k', () => 1]]), undefined: new Map([['k', () => 'late']]) };
function probe20() { const v = T20[k20]; return v.get('k')(); }
const first20 = probe20();
var k20 = 'a';
console.log('map-value', String(first20), typeof first20, String(probe20()), String(0));
// symbol-key
const sym21 = Symbol();
const T21 = { a: { [sym21]: 1 }, undefined: { [sym21]: 'late' } };
function probe21() { const v = T21[k21]; return v[sym21]; }
const first21 = probe21();
var k21 = 'a';
console.log('symbol-key', String(first21), typeof first21, String(probe21()), String(0));
// private-field
class A22 { #p; constructor(p) { this.#p = p; } static read(o) { return o.#p; } }
const T22 = { a: new A22(1), undefined: new A22('late') };
function probe22() { const v = T22[k22]; return A22.read(v); }
const first22 = probe22();
var k22 = 'a';
console.log('private-field', String(first22), typeof first22, String(probe22()), String(0));
// private-in
class A23 { #p = 1; static has(o) { return #p in o; } }
const T23 = { a: new A23(), undefined: {} };
function probe23() { const v = T23[k23]; return A23.has(v); }
const first23 = probe23();
var k23 = 'a';
console.log('private-in', String(first23), typeof first23, String(probe23()), String(0));
// regexp
const T24 = { a: /a/, undefined: { exec() { return null; }, test() { return 'late'; } } };
function probe24() { const v = T24[k24]; return v.test('a'); }
const first24 = probe24();
var k24 = 'a';
console.log('regexp', String(first24), typeof first24, String(probe24()), String(0));
// date
const T25 = { a: new Date(0), undefined: { getTime() { return 'late'; } } };
function probe25() { const v = T25[k25]; return v.getTime(); }
const first25 = probe25();
var k25 = 'a';
console.log('date', String(first25), typeof first25, String(probe25()), String(0));
// typed-array
const T26 = { a: new Uint8Array([1]), undefined: new Float64Array([1.5]) };
function probe26() { const v = T26[k26]; return v[0] + 1; }
const first26 = probe26();
var k26 = 'a';
console.log('typed-array', String(first26), typeof first26, String(probe26()), String(0));
// typed-array-or-array
const T27 = { a: new Uint8Array([1]), undefined: ['late'] };
function probe27() { const v = T27[k27]; return v[0]; }
const first27 = probe27();
var k27 = 'a';
console.log('typed-array-or-array', String(first27), typeof first27, String(probe27()), String(0));
// array-holes
const T28 = { a: [1, 2], undefined: [, 2] };
function probe28() { const v = T28[k28]; return v[0]; }
const first28 = probe28();
var k28 = 'a';
console.log('array-holes', String(first28), typeof first28, String(probe28()), String(0));
// array-doubles
const T29 = { a: [1, 2], undefined: [1.5, 2] };
function probe29() { const v = T29[k29]; return v[0] + 1; }
const first29 = probe29();
var k29 = 'a';
console.log('array-doubles', String(first29), typeof first29, String(probe29()), String(0));
// array-length
const T30 = { a: [1, 2], undefined: { length: 'late' } };
function probe30() { const v = T30[k30]; return v.length; }
const first30 = probe30();
var k30 = 'a';
console.log('array-length', String(first30), typeof first30, String(probe30()), String(0));
// second-level-leak
let innerSink31, inner31 = 'none'; class Inner31 { constructor() { innerSink31 = this; inner31 = typeof innerSink31.f; this.f = 1; } }
const T31 = { a: () => 1, undefined: () => { new Inner31(); return inner31; } };
function probe31() { const v = T31[k31]; return v(); }
const first31 = probe31();
var k31 = 'a';
console.log('second-level-leak', String(first31), typeof first31, String(probe31()), String(typeof innerSink31.f));
// second-level-variable
const T32 = { a: () => 1, undefined: () => typeof laterVariable32 };
function probe32() { const v = T32[k32]; return v(); }
const first32 = probe32();
var k32 = 'a';
var laterVariable32 = 1;
console.log('second-level-variable', String(first32), typeof first32, String(probe32()), String(typeof laterVariable32));
