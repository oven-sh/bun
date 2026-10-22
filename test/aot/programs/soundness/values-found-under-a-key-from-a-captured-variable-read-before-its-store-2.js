// Each table is read under a key that comes from a captured variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// map-foreach-callback
let side0 = 0;
const T0 = { a: () => {}, undefined: (val, key) => { side0 = val; } };
function outer0() { const probe = () => { const v = T0[k]; new Map([[1, 'late']]).forEach(v); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first0, second0] = outer0();
console.log('map-foreach-callback', String(first0), typeof first0, String(second0), String(side0));
// replace-callback
const T1 = { a: () => 'e', undefined: () => 'late' };
function outer1() { const probe = () => { const v = T1[k]; return 'ab'.replace(/a/, v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first1, second1] = outer1();
console.log('replace-callback', String(first1), typeof first1, String(second1), String(0));
// json-reviver
const T2 = { a: (k, x) => x, undefined: (k, x) => typeof x == 'number' ? 'late' : x };
function outer2() { const probe = () => { const v = T2[k]; return JSON.parse('[1]', v)[0]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first2, second2] = outer2();
console.log('json-reviver', String(first2), typeof first2, String(second2), String(0));
// promise-executor
let side3 = 0;
const T3 = { a: r => {}, undefined: r => { side3 = 'late'; } };
function outer3() { const probe = () => { const v = T3[k]; new Promise(v); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first3, second3] = outer3();
console.log('promise-executor', String(first3), typeof first3, String(second3), String(side3));
// function-call
const T4 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function outer4() { const probe = () => { const v = T4[k]; return v.call(null); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first4, second4] = outer4();
console.log('function-call', String(first4), typeof first4, String(second4), String(0));
// function-apply
const T5 = { a: function (a) { return a; }, undefined: function (a) { return 'late' + a; } };
function outer5() { const probe = () => { const v = T5[k]; return v.apply(null, [1]); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first5, second5] = outer5();
console.log('function-apply', String(first5), typeof first5, String(second5), String(0));
// function-bind
const T6 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function outer6() { const probe = () => { const v = T6[k]; return v.bind(null)(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first6, second6] = outer6();
console.log('function-bind', String(first6), typeof first6, String(second6), String(0));
// yield-star
const T7 = { a: [1], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function outer7() { const probe = () => { const v = T7[k]; function* g() { yield* v; } return g().next().value; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first7, second7] = outer7();
console.log('yield-star', String(first7), typeof first7, String(second7), String(0));
// for-in
const T8 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function outer8() { const probe = () => { const v = T8[k]; let r = ''; for (const k in v) r += k; return r; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first8, second8] = outer8();
console.log('for-in', String(first8), typeof first8, String(second8), String(0));
// keys
const T9 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function outer9() { const probe = () => { const v = T9[k]; return Object.keys(v).join(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first9, second9] = outer9();
console.log('keys', String(first9), typeof first9, String(second9), String(0));
// values
const T10 = { a: { a: 1 }, undefined: { b: 'late' } };
function outer10() { const probe = () => { const v = T10[k]; return Object.values(v)[0]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first10, second10] = outer10();
console.log('values', String(first10), typeof first10, String(second10), String(0));
// entries
const T11 = { a: { a: 1 }, undefined: { get b() { return 'late'; } } };
function outer11() { const probe = () => { const v = T11[k]; return Object.entries(v)[0][1]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first11, second11] = outer11();
console.log('entries', String(first11), typeof first11, String(second11), String(0));
// assign
const T12 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function outer12() { const probe = () => { const v = T12[k]; return Object.assign({}, v).a; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first12, second12] = outer12();
console.log('assign', String(first12), typeof first12, String(second12), String(0));
// object-spread
const T13 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function outer13() { const probe = () => { const v = T13[k]; return ({ ...v }).a; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first13, second13] = outer13();
console.log('object-spread', String(first13), typeof first13, String(second13), String(0));
// in-proxy
let side14 = 0;
const T14 = { a: { x: 1 }, undefined: new Proxy({}, { has() { side14++; return false; } }) };
function outer14() { const probe = () => { const v = T14[k]; return 'x' in v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first14, second14] = outer14();
console.log('in-proxy', String(first14), typeof first14, String(second14), String(side14));
// proxy-handler
const T15 = { a: {}, undefined: { get() { return 'late'; } } };
function outer15() { const probe = () => { const v = T15[k]; return new Proxy({ foo: 1 }, v).foo; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first15, second15] = outer15();
console.log('proxy-handler', String(first15), typeof first15, String(second15), String(0));
// tagged-template
const T16 = { a: () => 1, undefined: s => 'late' + s[0] };
function outer16() { const probe = () => { const v = T16[k]; return v`x`; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first16, second16] = outer16();
console.log('tagged-template', String(first16), typeof first16, String(second16), String(0));
// typeof
const T17 = { a: 1, undefined: 'late' };
function outer17() { const probe = () => { const v = T17[k]; return typeof v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first17, second17] = outer17();
console.log('typeof', String(first17), typeof first17, String(second17), String(0));
// typeof-function
const T18 = { a: () => 1, undefined: {} };
function outer18() { const probe = () => { const v = T18[k]; return typeof v === 'function'; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first18, second18] = outer18();
console.log('typeof-function', String(first18), typeof first18, String(second18), String(0));
// is-array
const T19 = { a: [1], undefined: { length: 1 } };
function outer19() { const probe = () => { const v = T19[k]; return Array.isArray(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first19, second19] = outer19();
console.log('is-array', String(first19), typeof first19, String(second19), String(0));
// identity
const same20 = { x: 1 };
const T20 = { a: same20, undefined: { x: 1 } };
function outer20() { const probe = () => { const v = T20[k]; return v === same20; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first20, second20] = outer20();
console.log('identity', String(first20), typeof first20, String(second20), String(0));
// nullish
const T21 = { a: 1, undefined: null };
function outer21() { const probe = () => { const v = T21[k]; return v ?? 'late'; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first21, second21] = outer21();
console.log('nullish', String(first21), typeof first21, String(second21), String(0));
// truthy
const T22 = { a: 1, undefined: 0 };
function outer22() { const probe = () => { const v = T22[k]; return v ? 'e' : 'late'; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first22, second22] = outer22();
console.log('truthy', String(first22), typeof first22, String(second22), String(0));
// optional-call
const T23 = { a: () => 1, undefined: undefined };
function outer23() { const probe = () => { const v = T23[k]; return v?.(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first23, second23] = outer23();
console.log('optional-call', String(first23), typeof first23, String(second23), String(0));
// constructor-identity
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function outer24() { const probe = () => { const v = T24[k]; return v.constructor === A24; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first24, second24] = outer24();
console.log('constructor-identity', String(first24), typeof first24, String(second24), String(0));
// prototype-identity
class A25 {} class B25 {}
const T25 = { a: new A25(), undefined: new B25() };
function outer25() { const probe = () => { const v = T25[k]; return Object.getPrototypeOf(v) === A25.prototype; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first25, second25] = outer25();
console.log('prototype-identity', String(first25), typeof first25, String(second25), String(0));
// has-own
const T26 = { a: { x: 1 }, undefined: { y: 1 } };
function outer26() { const probe = () => { const v = T26[k]; return Object.hasOwn(v, 'x'); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first26, second26] = outer26();
console.log('has-own', String(first26), typeof first26, String(second26), String(0));
// in
const T27 = { a: { x: 1 }, undefined: { y: 1 } };
function outer27() { const probe = () => { const v = T27[k]; return 'x' in v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first27, second27] = outer27();
console.log('in', String(first27), typeof first27, String(second27), String(0));
// store-alias
const aliased28 = { x: 1 };
const T28 = { a: { x: 1 }, undefined: aliased28 };
function outer28() { const probe = () => { const v = T28[k]; v.x = 's'; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first28, second28] = outer28();
console.log('store-alias', String(first28), typeof first28, String(second28), String(aliased28.x + 1));
// element-store-alias
const aliased29 = [1, 2];
const T29 = { a: [1], undefined: aliased29 };
function outer29() { const probe = () => { const v = T29[k]; v[0] = 's'; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first29, second29] = outer29();
console.log('element-store-alias', String(first29), typeof first29, String(second29), String(aliased29[0] + 1));
// delete-alias
const aliased30 = { x: 1 };
const T30 = { a: { x: 1 }, undefined: aliased30 };
function outer30() { const probe = () => { const v = T30[k]; delete v.x; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first30, second30] = outer30();
console.log('delete-alias', String(first30), typeof first30, String(second30), String(aliased30.x));
// freeze-alias
const aliased31 = { x: 1 };
const T31 = { a: { x: 1 }, undefined: aliased31 };
function outer31() { const probe = () => { const v = T31[k]; Object.freeze(v); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first31, second31] = outer31();
console.log('freeze-alias', String(first31), typeof first31, String(second31), String((() => { try { aliased31.x = 2; } catch { return 'threw'; } return aliased31.x; })()));
// define-alias
const aliased32 = { x: 1 };
const T32 = { a: { x: 1 }, undefined: aliased32 };
function outer32() { const probe = () => { const v = T32[k]; Object.defineProperty(v, 'x', { get() { return 'late'; } }); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first32, second32] = outer32();
console.log('define-alias', String(first32), typeof first32, String(second32), String(aliased32.x));
// length-alias
const aliased33 = [1, 2];
const T33 = { a: [1], undefined: aliased33 };
function outer33() { const probe = () => { const v = T33[k]; v.length = 0; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first33, second33] = outer33();
console.log('length-alias', String(first33), typeof first33, String(second33), String(aliased33.length + ':' + aliased33[0]));
// push-alias
const aliased34 = [1, 2];
const T34 = { a: [1], undefined: aliased34 };
function outer34() { const probe = () => { const v = T34[k]; v.push('s'); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first34, second34] = outer34();
console.log('push-alias', String(first34), typeof first34, String(second34), String(aliased34[2] + 1));
// map-set-alias
const aliased35 = new Map([['k', 1]]);
const T35 = { a: new Map(), undefined: aliased35 };
function outer35() { const probe = () => { const v = T35[k]; v.set('k', 's'); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first35, second35] = outer35();
console.log('map-set-alias', String(first35), typeof first35, String(second35), String(aliased35.get('k') + 1));
// add-property-alias
const aliased36 = { x: 1 };
const T36 = { a: { x: 1 }, undefined: aliased36 };
function outer36() { const probe = () => { const v = T36[k]; v.added = 's'; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first36, second36] = outer36();
console.log('add-property-alias', String(first36), typeof first36, String(second36), String(Object.keys(aliased36).join() + aliased36.added));
// set-prototype-alias
const aliased37 = { x: 1 };
const T37 = { a: { x: 1 }, undefined: aliased37 };
function outer37() { const probe = () => { const v = T37[k]; Object.setPrototypeOf(v, { inherited: 'late' }); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first37, second37] = outer37();
console.log('set-prototype-alias', String(first37), typeof first37, String(second37), String(aliased37.inherited));
// static-count
class Late38 { static n = 1; }
const T38 = { a: class { static n = 1; }, undefined: Late38 };
function outer38() { const probe = () => { const v = T38[k]; v.n += 's'; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first38, second38] = outer38();
console.log('static-count', String(first38), typeof first38, String(second38), String(Late38.n + 1));
// prototype-method-store
class Late39 { m() { return 1; } }
const T39 = { a: class { m() { return 1; } }, undefined: Late39 };
function outer39() { const probe = () => { const v = T39[k]; v.prototype.m = () => 'late'; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first39, second39] = outer39();
console.log('prototype-method-store', String(first39), typeof first39, String(second39), String(new Late39().m()));
