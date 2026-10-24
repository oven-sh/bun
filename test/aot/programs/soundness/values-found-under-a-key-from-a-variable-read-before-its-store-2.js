// Each table is read under a key that comes from a variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// map-foreach-callback
let side0 = 0;
const T0 = { a: () => {}, undefined: (val, key) => { side0 = val; } };
function probe0() { const v = T0[k0]; new Map([[1, 'late']]).forEach(v); return 0; }
const first0 = probe0();
var k0 = 'a';
console.log('map-foreach-callback', String(first0), typeof first0, String(probe0()), String(side0));
// replace-callback
const T1 = { a: () => 'e', undefined: () => 'late' };
function probe1() { const v = T1[k1]; return 'ab'.replace(/a/, v); }
const first1 = probe1();
var k1 = 'a';
console.log('replace-callback', String(first1), typeof first1, String(probe1()), String(0));
// json-reviver
const T2 = { a: (k, x) => x, undefined: (k, x) => typeof x == 'number' ? 'late' : x };
function probe2() { const v = T2[k2]; return JSON.parse('[1]', v)[0]; }
const first2 = probe2();
var k2 = 'a';
console.log('json-reviver', String(first2), typeof first2, String(probe2()), String(0));
// promise-executor
let side3 = 0;
const T3 = { a: r => {}, undefined: r => { side3 = 'late'; } };
function probe3() { const v = T3[k3]; new Promise(v); return 0; }
const first3 = probe3();
var k3 = 'a';
console.log('promise-executor', String(first3), typeof first3, String(probe3()), String(side3));
// function-call
const T4 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function probe4() { const v = T4[k4]; return v.call(null); }
const first4 = probe4();
var k4 = 'a';
console.log('function-call', String(first4), typeof first4, String(probe4()), String(0));
// function-apply
const T5 = { a: function (a) { return a; }, undefined: function (a) { return 'late' + a; } };
function probe5() { const v = T5[k5]; return v.apply(null, [1]); }
const first5 = probe5();
var k5 = 'a';
console.log('function-apply', String(first5), typeof first5, String(probe5()), String(0));
// function-bind
const T6 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function probe6() { const v = T6[k6]; return v.bind(null)(); }
const first6 = probe6();
var k6 = 'a';
console.log('function-bind', String(first6), typeof first6, String(probe6()), String(0));
// yield-star
const T7 = { a: [1], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function probe7() { const v = T7[k7]; function* g() { yield* v; } return g().next().value; }
const first7 = probe7();
var k7 = 'a';
console.log('yield-star', String(first7), typeof first7, String(probe7()), String(0));
// for-in
const T8 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function probe8() { const v = T8[k8]; let r = ''; for (const k in v) r += k; return r; }
const first8 = probe8();
var k8 = 'a';
console.log('for-in', String(first8), typeof first8, String(probe8()), String(0));
// keys
const T9 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function probe9() { const v = T9[k9]; return Object.keys(v).join(); }
const first9 = probe9();
var k9 = 'a';
console.log('keys', String(first9), typeof first9, String(probe9()), String(0));
// values
const T10 = { a: { a: 1 }, undefined: { b: 'late' } };
function probe10() { const v = T10[k10]; return Object.values(v)[0]; }
const first10 = probe10();
var k10 = 'a';
console.log('values', String(first10), typeof first10, String(probe10()), String(0));
// entries
const T11 = { a: { a: 1 }, undefined: { get b() { return 'late'; } } };
function probe11() { const v = T11[k11]; return Object.entries(v)[0][1]; }
const first11 = probe11();
var k11 = 'a';
console.log('entries', String(first11), typeof first11, String(probe11()), String(0));
// assign
const T12 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function probe12() { const v = T12[k12]; return Object.assign({}, v).a; }
const first12 = probe12();
var k12 = 'a';
console.log('assign', String(first12), typeof first12, String(probe12()), String(0));
// object-spread
const T13 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function probe13() { const v = T13[k13]; return ({ ...v }).a; }
const first13 = probe13();
var k13 = 'a';
console.log('object-spread', String(first13), typeof first13, String(probe13()), String(0));
// in-proxy
let side14 = 0;
const T14 = { a: { x: 1 }, undefined: new Proxy({}, { has() { side14++; return false; } }) };
function probe14() { const v = T14[k14]; return 'x' in v; }
const first14 = probe14();
var k14 = 'a';
console.log('in-proxy', String(first14), typeof first14, String(probe14()), String(side14));
// proxy-handler
const T15 = { a: {}, undefined: { get() { return 'late'; } } };
function probe15() { const v = T15[k15]; return new Proxy({ foo: 1 }, v).foo; }
const first15 = probe15();
var k15 = 'a';
console.log('proxy-handler', String(first15), typeof first15, String(probe15()), String(0));
// tagged-template
const T16 = { a: () => 1, undefined: s => 'late' + s[0] };
function probe16() { const v = T16[k16]; return v`x`; }
const first16 = probe16();
var k16 = 'a';
console.log('tagged-template', String(first16), typeof first16, String(probe16()), String(0));
// typeof
const T17 = { a: 1, undefined: 'late' };
function probe17() { const v = T17[k17]; return typeof v; }
const first17 = probe17();
var k17 = 'a';
console.log('typeof', String(first17), typeof first17, String(probe17()), String(0));
// typeof-function
const T18 = { a: () => 1, undefined: {} };
function probe18() { const v = T18[k18]; return typeof v === 'function'; }
const first18 = probe18();
var k18 = 'a';
console.log('typeof-function', String(first18), typeof first18, String(probe18()), String(0));
// is-array
const T19 = { a: [1], undefined: { length: 1 } };
function probe19() { const v = T19[k19]; return Array.isArray(v); }
const first19 = probe19();
var k19 = 'a';
console.log('is-array', String(first19), typeof first19, String(probe19()), String(0));
// identity
const same20 = { x: 1 };
const T20 = { a: same20, undefined: { x: 1 } };
function probe20() { const v = T20[k20]; return v === same20; }
const first20 = probe20();
var k20 = 'a';
console.log('identity', String(first20), typeof first20, String(probe20()), String(0));
// nullish
const T21 = { a: 1, undefined: null };
function probe21() { const v = T21[k21]; return v ?? 'late'; }
const first21 = probe21();
var k21 = 'a';
console.log('nullish', String(first21), typeof first21, String(probe21()), String(0));
// truthy
const T22 = { a: 1, undefined: 0 };
function probe22() { const v = T22[k22]; return v ? 'e' : 'late'; }
const first22 = probe22();
var k22 = 'a';
console.log('truthy', String(first22), typeof first22, String(probe22()), String(0));
// optional-call
const T23 = { a: () => 1, undefined: undefined };
function probe23() { const v = T23[k23]; return v?.(); }
const first23 = probe23();
var k23 = 'a';
console.log('optional-call', String(first23), typeof first23, String(probe23()), String(0));
// constructor-identity
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function probe24() { const v = T24[k24]; return v.constructor === A24; }
const first24 = probe24();
var k24 = 'a';
console.log('constructor-identity', String(first24), typeof first24, String(probe24()), String(0));
// prototype-identity
class A25 {} class B25 {}
const T25 = { a: new A25(), undefined: new B25() };
function probe25() { const v = T25[k25]; return Object.getPrototypeOf(v) === A25.prototype; }
const first25 = probe25();
var k25 = 'a';
console.log('prototype-identity', String(first25), typeof first25, String(probe25()), String(0));
// has-own
const T26 = { a: { x: 1 }, undefined: { y: 1 } };
function probe26() { const v = T26[k26]; return Object.hasOwn(v, 'x'); }
const first26 = probe26();
var k26 = 'a';
console.log('has-own', String(first26), typeof first26, String(probe26()), String(0));
// in
const T27 = { a: { x: 1 }, undefined: { y: 1 } };
function probe27() { const v = T27[k27]; return 'x' in v; }
const first27 = probe27();
var k27 = 'a';
console.log('in', String(first27), typeof first27, String(probe27()), String(0));
// store-alias
const aliased28 = { x: 1 };
const T28 = { a: { x: 1 }, undefined: aliased28 };
function probe28() { const v = T28[k28]; v.x = 's'; return 0; }
const first28 = probe28();
var k28 = 'a';
console.log('store-alias', String(first28), typeof first28, String(probe28()), String(aliased28.x + 1));
// element-store-alias
const aliased29 = [1, 2];
const T29 = { a: [1], undefined: aliased29 };
function probe29() { const v = T29[k29]; v[0] = 's'; return 0; }
const first29 = probe29();
var k29 = 'a';
console.log('element-store-alias', String(first29), typeof first29, String(probe29()), String(aliased29[0] + 1));
// delete-alias
const aliased30 = { x: 1 };
const T30 = { a: { x: 1 }, undefined: aliased30 };
function probe30() { const v = T30[k30]; delete v.x; return 0; }
const first30 = probe30();
var k30 = 'a';
console.log('delete-alias', String(first30), typeof first30, String(probe30()), String(aliased30.x));
// freeze-alias
const aliased31 = { x: 1 };
const T31 = { a: { x: 1 }, undefined: aliased31 };
function probe31() { const v = T31[k31]; Object.freeze(v); return 0; }
const first31 = probe31();
var k31 = 'a';
console.log('freeze-alias', String(first31), typeof first31, String(probe31()), String((() => { try { aliased31.x = 2; } catch { return 'threw'; } return aliased31.x; })()));
// define-alias
const aliased32 = { x: 1 };
const T32 = { a: { x: 1 }, undefined: aliased32 };
function probe32() { const v = T32[k32]; Object.defineProperty(v, 'x', { get() { return 'late'; } }); return 0; }
const first32 = probe32();
var k32 = 'a';
console.log('define-alias', String(first32), typeof first32, String(probe32()), String(aliased32.x));
// length-alias
const aliased33 = [1, 2];
const T33 = { a: [1], undefined: aliased33 };
function probe33() { const v = T33[k33]; v.length = 0; return 0; }
const first33 = probe33();
var k33 = 'a';
console.log('length-alias', String(first33), typeof first33, String(probe33()), String(aliased33.length + ':' + aliased33[0]));
// push-alias
const aliased34 = [1, 2];
const T34 = { a: [1], undefined: aliased34 };
function probe34() { const v = T34[k34]; v.push('s'); return 0; }
const first34 = probe34();
var k34 = 'a';
console.log('push-alias', String(first34), typeof first34, String(probe34()), String(aliased34[2] + 1));
// map-set-alias
const aliased35 = new Map([['k', 1]]);
const T35 = { a: new Map(), undefined: aliased35 };
function probe35() { const v = T35[k35]; v.set('k', 's'); return 0; }
const first35 = probe35();
var k35 = 'a';
console.log('map-set-alias', String(first35), typeof first35, String(probe35()), String(aliased35.get('k') + 1));
// add-property-alias
const aliased36 = { x: 1 };
const T36 = { a: { x: 1 }, undefined: aliased36 };
function probe36() { const v = T36[k36]; v.added = 's'; return 0; }
const first36 = probe36();
var k36 = 'a';
console.log('add-property-alias', String(first36), typeof first36, String(probe36()), String(Object.keys(aliased36).join() + aliased36.added));
// set-prototype-alias
const aliased37 = { x: 1 };
const T37 = { a: { x: 1 }, undefined: aliased37 };
function probe37() { const v = T37[k37]; Object.setPrototypeOf(v, { inherited: 'late' }); return 0; }
const first37 = probe37();
var k37 = 'a';
console.log('set-prototype-alias', String(first37), typeof first37, String(probe37()), String(aliased37.inherited));
// static-count
class Late38 { static n = 1; }
const T38 = { a: class { static n = 1; }, undefined: Late38 };
function probe38() { const v = T38[k38]; v.n += 's'; return 0; }
const first38 = probe38();
var k38 = 'a';
console.log('static-count', String(first38), typeof first38, String(probe38()), String(Late38.n + 1));
// prototype-method-store
class Late39 { m() { return 1; } }
const T39 = { a: class { m() { return 1; } }, undefined: Late39 };
function probe39() { const v = T39[k39]; v.prototype.m = () => 'late'; return 0; }
const first39 = probe39();
var k39 = 'a';
console.log('prototype-method-store', String(first39), typeof first39, String(probe39()), String(new Late39().m()));
