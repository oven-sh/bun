// Each table is read under a key that comes from a static field that is read before it is defined: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// throw
const T0 = { a: 1, undefined: { tag: 'late' } };
function probe0(c) { const v = T0[c.k]; try { throw v; } catch (e) { return typeof e === 'number' ? e : e.tag; } }
class S0 { static r = probe0(this); static k = 'a'; }
const first0 = S0.r;
console.log('throw', String(first0), typeof first0, String(probe0(S0)), String(0));
// number-double
const T1 = { a: 1, undefined: 1.5 };
function probe1(c) { const v = T1[c.k]; return v + 1; }
class S1 { static r = probe1(this); static k = 'a'; }
const first1 = S1.r;
console.log('number-double', String(first1), typeof first1, String(probe1(S1)), String(0));
// number-large
const T2 = { a: 1, undefined: 2 ** 40 };
function probe2(c) { const v = T2[c.k]; return v + 1; }
class S2 { static r = probe2(this); static k = 'a'; }
const first2 = S2.r;
console.log('number-large', String(first2), typeof first2, String(probe2(S2)), String(0));
// number-negative-zero
const T3 = { a: 1, undefined: -0 };
function probe3(c) { const v = T3[c.k]; return 1 / v; }
class S3 { static r = probe3(this); static k = 'a'; }
const first3 = S3.r;
console.log('number-negative-zero', String(first3), typeof first3, String(probe3(S3)), String(0));
// number-nan
const T4 = { a: 1, undefined: NaN };
function probe4(c) { const v = T4[c.k]; return v === v; }
class S4 { static r = probe4(this); static k = 'a'; }
const first4 = S4.r;
console.log('number-nan', String(first4), typeof first4, String(probe4(S4)), String(0));
// number-bigint
const T5 = { a: 1, undefined: 1n };
function probe5(c) { const v = T5[c.k]; return typeof (v * v); }
class S5 { static r = probe5(this); static k = 'a'; }
const first5 = S5.r;
console.log('number-bigint', String(first5), typeof first5, String(probe5(S5)), String(0));
// number-string
const T6 = { a: 1, undefined: 's' };
function probe6(c) { const v = T6[c.k]; return v + 1; }
class S6 { static r = probe6(this); static k = 'a'; }
const first6 = S6.r;
console.log('number-string', String(first6), typeof first6, String(probe6(S6)), String(0));
// number-bitor
const T7 = { a: 1, undefined: 2 ** 32 + 5.5 };
function probe7(c) { const v = T7[c.k]; return v | 0; }
class S7 { static r = probe7(this); static k = 'a'; }
const first7 = S7.r;
console.log('number-bitor', String(first7), typeof first7, String(probe7(S7)), String(0));
// number-index
const T8 = { a: 0, undefined: 'length' };
function probe8(c) { const v = T8[c.k]; return [7, 8][v]; }
class S8 { static r = probe8(this); static k = 'a'; }
const first8 = S8.r;
console.log('number-index', String(first8), typeof first8, String(probe8(S8)), String(0));
// number-index-negative
const T9 = { a: 0, undefined: -1 };
function probe9(c) { const v = T9[c.k]; return [7, 8][v]; }
class S9 { static r = probe9(this); static k = 'a'; }
const first9 = S9.r;
console.log('number-index-negative', String(first9), typeof first9, String(probe9(S9)), String(0));
// number-index-far
const T10 = { a: 0, undefined: 5 };
function probe10(c) { const v = T10[c.k]; return [7, 8][v]; }
class S10 { static r = probe10(this); static k = 'a'; }
const first10 = S10.r;
console.log('number-index-far', String(first10), typeof first10, String(probe10(S10)), String(0));
// string-length
const T11 = { a: 'a', undefined: 5 };
function probe11(c) { const v = T11[c.k]; return v.length; }
class S11 { static r = probe11(this); static k = 'a'; }
const first11 = S11.r;
console.log('string-length', String(first11), typeof first11, String(probe11(S11)), String(0));
// string-method
const T12 = { a: 'a', undefined: { charCodeAt() { return 'late'; } } };
function probe12(c) { const v = T12[c.k]; return v.charCodeAt(0); }
class S12 { static r = probe12(this); static k = 'a'; }
const first12 = S12.r;
console.log('string-method', String(first12), typeof first12, String(probe12(S12)), String(0));
// boolean
const T13 = { a: true, undefined: 'late' };
function probe13(c) { const v = T13[c.k]; return v === true; }
class S13 { static r = probe13(this); static k = 'a'; }
const first13 = S13.r;
console.log('boolean', String(first13), typeof first13, String(probe13(S13)), String(0));
// arguments-object
const T14 = { a: () => 1, undefined: () => 'late' };
function probe14(c) { const v = T14[c.k]; return (function () { return arguments[0](); })(v); }
class S14 { static r = probe14(this); static k = 'a'; }
const first14 = S14.r;
console.log('arguments-object', String(first14), typeof first14, String(probe14(S14)), String(0));
// rest
const T15 = { a: () => 1, undefined: () => 'late' };
function probe15(c) { const v = T15[c.k]; return ((...r) => r[0]())(v); }
class S15 { static r = probe15(this); static k = 'a'; }
const first15 = S15.r;
console.log('rest', String(first15), typeof first15, String(probe15(S15)), String(0));
// default-parameter
const T16 = { a: 1, undefined: undefined };
function probe16(c) { const v = T16[c.k]; return ((a = 'late') => a)(v); }
class S16 { static r = probe16(this); static k = 'a'; }
const first16 = S16.r;
console.log('default-parameter', String(first16), typeof first16, String(probe16(S16)), String(0));
// closure-state
let count17 = 0.5;
const T17 = { a: () => 1, undefined: () => ++count17 };
function probe17(c) { const v = T17[c.k]; return v(); }
class S17 { static r = probe17(this); static k = 'a'; }
const first17 = S17.r;
console.log('closure-state', String(first17), typeof first17, String(probe17(S17)), String(count17));
// array-element
const T18 = { a: [() => 1], undefined: [() => 'late'] };
function probe18(c) { const v = T18[c.k]; return v[0](); }
class S18 { static r = probe18(this); static k = 'a'; }
const first18 = S18.r;
console.log('array-element', String(first18), typeof first18, String(probe18(S18)), String(0));
// nested-object
const T19 = { a: { in: { f() { return 1; } } }, undefined: { in: { f() { return 'late'; } } } };
function probe19(c) { const v = T19[c.k]; return v.in.f(); }
class S19 { static r = probe19(this); static k = 'a'; }
const first19 = S19.r;
console.log('nested-object', String(first19), typeof first19, String(probe19(S19)), String(0));
// map-value
const T20 = { a: new Map([['k', () => 1]]), undefined: new Map([['k', () => 'late']]) };
function probe20(c) { const v = T20[c.k]; return v.get('k')(); }
class S20 { static r = probe20(this); static k = 'a'; }
const first20 = S20.r;
console.log('map-value', String(first20), typeof first20, String(probe20(S20)), String(0));
// symbol-key
const sym21 = Symbol();
const T21 = { a: { [sym21]: 1 }, undefined: { [sym21]: 'late' } };
function probe21(c) { const v = T21[c.k]; return v[sym21]; }
class S21 { static r = probe21(this); static k = 'a'; }
const first21 = S21.r;
console.log('symbol-key', String(first21), typeof first21, String(probe21(S21)), String(0));
// private-field
class A22 { #p; constructor(p) { this.#p = p; } static read(o) { return o.#p; } }
const T22 = { a: new A22(1), undefined: new A22('late') };
function probe22(c) { const v = T22[c.k]; return A22.read(v); }
class S22 { static r = probe22(this); static k = 'a'; }
const first22 = S22.r;
console.log('private-field', String(first22), typeof first22, String(probe22(S22)), String(0));
// private-in
class A23 { #p = 1; static has(o) { return #p in o; } }
const T23 = { a: new A23(), undefined: {} };
function probe23(c) { const v = T23[c.k]; return A23.has(v); }
class S23 { static r = probe23(this); static k = 'a'; }
const first23 = S23.r;
console.log('private-in', String(first23), typeof first23, String(probe23(S23)), String(0));
// regexp
const T24 = { a: /a/, undefined: { exec() { return null; }, test() { return 'late'; } } };
function probe24(c) { const v = T24[c.k]; return v.test('a'); }
class S24 { static r = probe24(this); static k = 'a'; }
const first24 = S24.r;
console.log('regexp', String(first24), typeof first24, String(probe24(S24)), String(0));
// date
const T25 = { a: new Date(0), undefined: { getTime() { return 'late'; } } };
function probe25(c) { const v = T25[c.k]; return v.getTime(); }
class S25 { static r = probe25(this); static k = 'a'; }
const first25 = S25.r;
console.log('date', String(first25), typeof first25, String(probe25(S25)), String(0));
// typed-array
const T26 = { a: new Uint8Array([1]), undefined: new Float64Array([1.5]) };
function probe26(c) { const v = T26[c.k]; return v[0] + 1; }
class S26 { static r = probe26(this); static k = 'a'; }
const first26 = S26.r;
console.log('typed-array', String(first26), typeof first26, String(probe26(S26)), String(0));
// typed-array-or-array
const T27 = { a: new Uint8Array([1]), undefined: ['late'] };
function probe27(c) { const v = T27[c.k]; return v[0]; }
class S27 { static r = probe27(this); static k = 'a'; }
const first27 = S27.r;
console.log('typed-array-or-array', String(first27), typeof first27, String(probe27(S27)), String(0));
// array-holes
const T28 = { a: [1, 2], undefined: [, 2] };
function probe28(c) { const v = T28[c.k]; return v[0]; }
class S28 { static r = probe28(this); static k = 'a'; }
const first28 = S28.r;
console.log('array-holes', String(first28), typeof first28, String(probe28(S28)), String(0));
// array-doubles
const T29 = { a: [1, 2], undefined: [1.5, 2] };
function probe29(c) { const v = T29[c.k]; return v[0] + 1; }
class S29 { static r = probe29(this); static k = 'a'; }
const first29 = S29.r;
console.log('array-doubles', String(first29), typeof first29, String(probe29(S29)), String(0));
// array-length
const T30 = { a: [1, 2], undefined: { length: 'late' } };
function probe30(c) { const v = T30[c.k]; return v.length; }
class S30 { static r = probe30(this); static k = 'a'; }
const first30 = S30.r;
console.log('array-length', String(first30), typeof first30, String(probe30(S30)), String(0));
// second-level-leak
let innerSink31, inner31 = 'none'; class Inner31 { constructor() { innerSink31 = this; inner31 = typeof innerSink31.f; this.f = 1; } }
const T31 = { a: () => 1, undefined: () => { new Inner31(); return inner31; } };
function probe31(c) { const v = T31[c.k]; return v(); }
class S31 { static r = probe31(this); static k = 'a'; }
const first31 = S31.r;
console.log('second-level-leak', String(first31), typeof first31, String(probe31(S31)), String(typeof innerSink31.f));
// second-level-variable
const T32 = { a: () => 1, undefined: () => typeof laterVariable32 };
function probe32(c) { const v = T32[c.k]; return v(); }
class S32 { static r = probe32(this); static k = 'a'; }
const first32 = S32.r;
var laterVariable32 = 1;
console.log('second-level-variable', String(first32), typeof first32, String(probe32(S32)), String(typeof laterVariable32));
