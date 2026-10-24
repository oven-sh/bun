// Each table is read under a key that comes from a captured variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// throw
const T0 = { a: 1, undefined: { tag: 'late' } };
function outer0() { const probe = () => { const v = T0[k]; try { throw v; } catch (e) { return typeof e === 'number' ? e : e.tag; } }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first0, second0] = outer0();
console.log('throw', String(first0), typeof first0, String(second0), String(0));
// number-double
const T1 = { a: 1, undefined: 1.5 };
function outer1() { const probe = () => { const v = T1[k]; return v + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first1, second1] = outer1();
console.log('number-double', String(first1), typeof first1, String(second1), String(0));
// number-large
const T2 = { a: 1, undefined: 2 ** 40 };
function outer2() { const probe = () => { const v = T2[k]; return v + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first2, second2] = outer2();
console.log('number-large', String(first2), typeof first2, String(second2), String(0));
// number-negative-zero
const T3 = { a: 1, undefined: -0 };
function outer3() { const probe = () => { const v = T3[k]; return 1 / v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first3, second3] = outer3();
console.log('number-negative-zero', String(first3), typeof first3, String(second3), String(0));
// number-nan
const T4 = { a: 1, undefined: NaN };
function outer4() { const probe = () => { const v = T4[k]; return v === v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first4, second4] = outer4();
console.log('number-nan', String(first4), typeof first4, String(second4), String(0));
// number-bigint
const T5 = { a: 1, undefined: 1n };
function outer5() { const probe = () => { const v = T5[k]; return typeof (v * v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first5, second5] = outer5();
console.log('number-bigint', String(first5), typeof first5, String(second5), String(0));
// number-string
const T6 = { a: 1, undefined: 's' };
function outer6() { const probe = () => { const v = T6[k]; return v + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first6, second6] = outer6();
console.log('number-string', String(first6), typeof first6, String(second6), String(0));
// number-bitor
const T7 = { a: 1, undefined: 2 ** 32 + 5.5 };
function outer7() { const probe = () => { const v = T7[k]; return v | 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first7, second7] = outer7();
console.log('number-bitor', String(first7), typeof first7, String(second7), String(0));
// number-index
const T8 = { a: 0, undefined: 'length' };
function outer8() { const probe = () => { const v = T8[k]; return [7, 8][v]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first8, second8] = outer8();
console.log('number-index', String(first8), typeof first8, String(second8), String(0));
// number-index-negative
const T9 = { a: 0, undefined: -1 };
function outer9() { const probe = () => { const v = T9[k]; return [7, 8][v]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first9, second9] = outer9();
console.log('number-index-negative', String(first9), typeof first9, String(second9), String(0));
// number-index-far
const T10 = { a: 0, undefined: 5 };
function outer10() { const probe = () => { const v = T10[k]; return [7, 8][v]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first10, second10] = outer10();
console.log('number-index-far', String(first10), typeof first10, String(second10), String(0));
// string-length
const T11 = { a: 'a', undefined: 5 };
function outer11() { const probe = () => { const v = T11[k]; return v.length; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first11, second11] = outer11();
console.log('string-length', String(first11), typeof first11, String(second11), String(0));
// string-method
const T12 = { a: 'a', undefined: { charCodeAt() { return 'late'; } } };
function outer12() { const probe = () => { const v = T12[k]; return v.charCodeAt(0); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first12, second12] = outer12();
console.log('string-method', String(first12), typeof first12, String(second12), String(0));
// boolean
const T13 = { a: true, undefined: 'late' };
function outer13() { const probe = () => { const v = T13[k]; return v === true; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first13, second13] = outer13();
console.log('boolean', String(first13), typeof first13, String(second13), String(0));
// arguments-object
const T14 = { a: () => 1, undefined: () => 'late' };
function outer14() { const probe = () => { const v = T14[k]; return (function () { return arguments[0](); })(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first14, second14] = outer14();
console.log('arguments-object', String(first14), typeof first14, String(second14), String(0));
// rest
const T15 = { a: () => 1, undefined: () => 'late' };
function outer15() { const probe = () => { const v = T15[k]; return ((...r) => r[0]())(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first15, second15] = outer15();
console.log('rest', String(first15), typeof first15, String(second15), String(0));
// default-parameter
const T16 = { a: 1, undefined: undefined };
function outer16() { const probe = () => { const v = T16[k]; return ((a = 'late') => a)(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first16, second16] = outer16();
console.log('default-parameter', String(first16), typeof first16, String(second16), String(0));
// closure-state
let count17 = 0.5;
const T17 = { a: () => 1, undefined: () => ++count17 };
function outer17() { const probe = () => { const v = T17[k]; return v(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first17, second17] = outer17();
console.log('closure-state', String(first17), typeof first17, String(second17), String(count17));
// array-element
const T18 = { a: [() => 1], undefined: [() => 'late'] };
function outer18() { const probe = () => { const v = T18[k]; return v[0](); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first18, second18] = outer18();
console.log('array-element', String(first18), typeof first18, String(second18), String(0));
// nested-object
const T19 = { a: { in: { f() { return 1; } } }, undefined: { in: { f() { return 'late'; } } } };
function outer19() { const probe = () => { const v = T19[k]; return v.in.f(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first19, second19] = outer19();
console.log('nested-object', String(first19), typeof first19, String(second19), String(0));
// map-value
const T20 = { a: new Map([['k', () => 1]]), undefined: new Map([['k', () => 'late']]) };
function outer20() { const probe = () => { const v = T20[k]; return v.get('k')(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first20, second20] = outer20();
console.log('map-value', String(first20), typeof first20, String(second20), String(0));
// symbol-key
const sym21 = Symbol();
const T21 = { a: { [sym21]: 1 }, undefined: { [sym21]: 'late' } };
function outer21() { const probe = () => { const v = T21[k]; return v[sym21]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first21, second21] = outer21();
console.log('symbol-key', String(first21), typeof first21, String(second21), String(0));
// private-field
class A22 { #p; constructor(p) { this.#p = p; } static read(o) { return o.#p; } }
const T22 = { a: new A22(1), undefined: new A22('late') };
function outer22() { const probe = () => { const v = T22[k]; return A22.read(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first22, second22] = outer22();
console.log('private-field', String(first22), typeof first22, String(second22), String(0));
// private-in
class A23 { #p = 1; static has(o) { return #p in o; } }
const T23 = { a: new A23(), undefined: {} };
function outer23() { const probe = () => { const v = T23[k]; return A23.has(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first23, second23] = outer23();
console.log('private-in', String(first23), typeof first23, String(second23), String(0));
// regexp
const T24 = { a: /a/, undefined: { exec() { return null; }, test() { return 'late'; } } };
function outer24() { const probe = () => { const v = T24[k]; return v.test('a'); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first24, second24] = outer24();
console.log('regexp', String(first24), typeof first24, String(second24), String(0));
// date
const T25 = { a: new Date(0), undefined: { getTime() { return 'late'; } } };
function outer25() { const probe = () => { const v = T25[k]; return v.getTime(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first25, second25] = outer25();
console.log('date', String(first25), typeof first25, String(second25), String(0));
// typed-array
const T26 = { a: new Uint8Array([1]), undefined: new Float64Array([1.5]) };
function outer26() { const probe = () => { const v = T26[k]; return v[0] + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first26, second26] = outer26();
console.log('typed-array', String(first26), typeof first26, String(second26), String(0));
// typed-array-or-array
const T27 = { a: new Uint8Array([1]), undefined: ['late'] };
function outer27() { const probe = () => { const v = T27[k]; return v[0]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first27, second27] = outer27();
console.log('typed-array-or-array', String(first27), typeof first27, String(second27), String(0));
// array-holes
const T28 = { a: [1, 2], undefined: [, 2] };
function outer28() { const probe = () => { const v = T28[k]; return v[0]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first28, second28] = outer28();
console.log('array-holes', String(first28), typeof first28, String(second28), String(0));
// array-doubles
const T29 = { a: [1, 2], undefined: [1.5, 2] };
function outer29() { const probe = () => { const v = T29[k]; return v[0] + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first29, second29] = outer29();
console.log('array-doubles', String(first29), typeof first29, String(second29), String(0));
// array-length
const T30 = { a: [1, 2], undefined: { length: 'late' } };
function outer30() { const probe = () => { const v = T30[k]; return v.length; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first30, second30] = outer30();
console.log('array-length', String(first30), typeof first30, String(second30), String(0));
// second-level-leak
let innerSink31, inner31 = 'none'; class Inner31 { constructor() { innerSink31 = this; inner31 = typeof innerSink31.f; this.f = 1; } }
const T31 = { a: () => 1, undefined: () => { new Inner31(); return inner31; } };
function outer31() { const probe = () => { const v = T31[k]; return v(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first31, second31] = outer31();
console.log('second-level-leak', String(first31), typeof first31, String(second31), String(typeof innerSink31.f));
// second-level-variable
const T32 = { a: () => 1, undefined: () => typeof laterVariable32 };
function outer32() { const probe = () => { const v = T32[k]; return v(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first32, second32] = outer32();
var laterVariable32 = 1;
console.log('second-level-variable', String(first32), typeof first32, String(second32), String(typeof laterVariable32));
