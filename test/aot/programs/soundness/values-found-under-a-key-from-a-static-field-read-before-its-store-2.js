// Each table is read under a key that comes from a static field that is read before it is defined: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// map-foreach-callback
let side0 = 0;
const T0 = { a: () => {}, undefined: (val, key) => { side0 = val; } };
function probe0(c) { const v = T0[c.k]; new Map([[1, 'late']]).forEach(v); return 0; }
class S0 { static r = probe0(this); static k = 'a'; }
const first0 = S0.r;
console.log('map-foreach-callback', String(first0), typeof first0, String(probe0(S0)), String(side0));
// replace-callback
const T1 = { a: () => 'e', undefined: () => 'late' };
function probe1(c) { const v = T1[c.k]; return 'ab'.replace(/a/, v); }
class S1 { static r = probe1(this); static k = 'a'; }
const first1 = S1.r;
console.log('replace-callback', String(first1), typeof first1, String(probe1(S1)), String(0));
// json-reviver
const T2 = { a: (k, x) => x, undefined: (k, x) => typeof x == 'number' ? 'late' : x };
function probe2(c) { const v = T2[c.k]; return JSON.parse('[1]', v)[0]; }
class S2 { static r = probe2(this); static k = 'a'; }
const first2 = S2.r;
console.log('json-reviver', String(first2), typeof first2, String(probe2(S2)), String(0));
// promise-executor
let side3 = 0;
const T3 = { a: r => {}, undefined: r => { side3 = 'late'; } };
function probe3(c) { const v = T3[c.k]; new Promise(v); return 0; }
class S3 { static r = probe3(this); static k = 'a'; }
const first3 = S3.r;
console.log('promise-executor', String(first3), typeof first3, String(probe3(S3)), String(side3));
// function-call
const T4 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function probe4(c) { const v = T4[c.k]; return v.call(null); }
class S4 { static r = probe4(this); static k = 'a'; }
const first4 = S4.r;
console.log('function-call', String(first4), typeof first4, String(probe4(S4)), String(0));
// function-apply
const T5 = { a: function (a) { return a; }, undefined: function (a) { return 'late' + a; } };
function probe5(c) { const v = T5[c.k]; return v.apply(null, [1]); }
class S5 { static r = probe5(this); static k = 'a'; }
const first5 = S5.r;
console.log('function-apply', String(first5), typeof first5, String(probe5(S5)), String(0));
// function-bind
const T6 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
function probe6(c) { const v = T6[c.k]; return v.bind(null)(); }
class S6 { static r = probe6(this); static k = 'a'; }
const first6 = S6.r;
console.log('function-bind', String(first6), typeof first6, String(probe6(S6)), String(0));
// yield-star
const T7 = { a: [1], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function probe7(c) { const v = T7[c.k]; function* g() { yield* v; } return g().next().value; }
class S7 { static r = probe7(this); static k = 'a'; }
const first7 = S7.r;
console.log('yield-star', String(first7), typeof first7, String(probe7(S7)), String(0));
// for-in
const T8 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function probe8(c) { const v = T8[c.k]; let r = ''; for (const k in v) r += k; return r; }
class S8 { static r = probe8(this); static k = 'a'; }
const first8 = S8.r;
console.log('for-in', String(first8), typeof first8, String(probe8(S8)), String(0));
// keys
const T9 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
function probe9(c) { const v = T9[c.k]; return Object.keys(v).join(); }
class S9 { static r = probe9(this); static k = 'a'; }
const first9 = S9.r;
console.log('keys', String(first9), typeof first9, String(probe9(S9)), String(0));
// values
const T10 = { a: { a: 1 }, undefined: { b: 'late' } };
function probe10(c) { const v = T10[c.k]; return Object.values(v)[0]; }
class S10 { static r = probe10(this); static k = 'a'; }
const first10 = S10.r;
console.log('values', String(first10), typeof first10, String(probe10(S10)), String(0));
// entries
const T11 = { a: { a: 1 }, undefined: { get b() { return 'late'; } } };
function probe11(c) { const v = T11[c.k]; return Object.entries(v)[0][1]; }
class S11 { static r = probe11(this); static k = 'a'; }
const first11 = S11.r;
console.log('entries', String(first11), typeof first11, String(probe11(S11)), String(0));
// assign
const T12 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function probe12(c) { const v = T12[c.k]; return Object.assign({}, v).a; }
class S12 { static r = probe12(this); static k = 'a'; }
const first12 = S12.r;
console.log('assign', String(first12), typeof first12, String(probe12(S12)), String(0));
// object-spread
const T13 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
function probe13(c) { const v = T13[c.k]; return ({ ...v }).a; }
class S13 { static r = probe13(this); static k = 'a'; }
const first13 = S13.r;
console.log('object-spread', String(first13), typeof first13, String(probe13(S13)), String(0));
// in-proxy
let side14 = 0;
const T14 = { a: { x: 1 }, undefined: new Proxy({}, { has() { side14++; return false; } }) };
function probe14(c) { const v = T14[c.k]; return 'x' in v; }
class S14 { static r = probe14(this); static k = 'a'; }
const first14 = S14.r;
console.log('in-proxy', String(first14), typeof first14, String(probe14(S14)), String(side14));
// proxy-handler
const T15 = { a: {}, undefined: { get() { return 'late'; } } };
function probe15(c) { const v = T15[c.k]; return new Proxy({ foo: 1 }, v).foo; }
class S15 { static r = probe15(this); static k = 'a'; }
const first15 = S15.r;
console.log('proxy-handler', String(first15), typeof first15, String(probe15(S15)), String(0));
// tagged-template
const T16 = { a: () => 1, undefined: s => 'late' + s[0] };
function probe16(c) { const v = T16[c.k]; return v`x`; }
class S16 { static r = probe16(this); static k = 'a'; }
const first16 = S16.r;
console.log('tagged-template', String(first16), typeof first16, String(probe16(S16)), String(0));
// typeof
const T17 = { a: 1, undefined: 'late' };
function probe17(c) { const v = T17[c.k]; return typeof v; }
class S17 { static r = probe17(this); static k = 'a'; }
const first17 = S17.r;
console.log('typeof', String(first17), typeof first17, String(probe17(S17)), String(0));
// typeof-function
const T18 = { a: () => 1, undefined: {} };
function probe18(c) { const v = T18[c.k]; return typeof v === 'function'; }
class S18 { static r = probe18(this); static k = 'a'; }
const first18 = S18.r;
console.log('typeof-function', String(first18), typeof first18, String(probe18(S18)), String(0));
// is-array
const T19 = { a: [1], undefined: { length: 1 } };
function probe19(c) { const v = T19[c.k]; return Array.isArray(v); }
class S19 { static r = probe19(this); static k = 'a'; }
const first19 = S19.r;
console.log('is-array', String(first19), typeof first19, String(probe19(S19)), String(0));
// identity
const same20 = { x: 1 };
const T20 = { a: same20, undefined: { x: 1 } };
function probe20(c) { const v = T20[c.k]; return v === same20; }
class S20 { static r = probe20(this); static k = 'a'; }
const first20 = S20.r;
console.log('identity', String(first20), typeof first20, String(probe20(S20)), String(0));
// nullish
const T21 = { a: 1, undefined: null };
function probe21(c) { const v = T21[c.k]; return v ?? 'late'; }
class S21 { static r = probe21(this); static k = 'a'; }
const first21 = S21.r;
console.log('nullish', String(first21), typeof first21, String(probe21(S21)), String(0));
// truthy
const T22 = { a: 1, undefined: 0 };
function probe22(c) { const v = T22[c.k]; return v ? 'e' : 'late'; }
class S22 { static r = probe22(this); static k = 'a'; }
const first22 = S22.r;
console.log('truthy', String(first22), typeof first22, String(probe22(S22)), String(0));
// optional-call
const T23 = { a: () => 1, undefined: undefined };
function probe23(c) { const v = T23[c.k]; return v?.(); }
class S23 { static r = probe23(this); static k = 'a'; }
const first23 = S23.r;
console.log('optional-call', String(first23), typeof first23, String(probe23(S23)), String(0));
// constructor-identity
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function probe24(c) { const v = T24[c.k]; return v.constructor === A24; }
class S24 { static r = probe24(this); static k = 'a'; }
const first24 = S24.r;
console.log('constructor-identity', String(first24), typeof first24, String(probe24(S24)), String(0));
// prototype-identity
class A25 {} class B25 {}
const T25 = { a: new A25(), undefined: new B25() };
function probe25(c) { const v = T25[c.k]; return Object.getPrototypeOf(v) === A25.prototype; }
class S25 { static r = probe25(this); static k = 'a'; }
const first25 = S25.r;
console.log('prototype-identity', String(first25), typeof first25, String(probe25(S25)), String(0));
// has-own
const T26 = { a: { x: 1 }, undefined: { y: 1 } };
function probe26(c) { const v = T26[c.k]; return Object.hasOwn(v, 'x'); }
class S26 { static r = probe26(this); static k = 'a'; }
const first26 = S26.r;
console.log('has-own', String(first26), typeof first26, String(probe26(S26)), String(0));
// in
const T27 = { a: { x: 1 }, undefined: { y: 1 } };
function probe27(c) { const v = T27[c.k]; return 'x' in v; }
class S27 { static r = probe27(this); static k = 'a'; }
const first27 = S27.r;
console.log('in', String(first27), typeof first27, String(probe27(S27)), String(0));
// store-alias
const aliased28 = { x: 1 };
const T28 = { a: { x: 1 }, undefined: aliased28 };
function probe28(c) { const v = T28[c.k]; v.x = 's'; return 0; }
class S28 { static r = probe28(this); static k = 'a'; }
const first28 = S28.r;
console.log('store-alias', String(first28), typeof first28, String(probe28(S28)), String(aliased28.x + 1));
// element-store-alias
const aliased29 = [1, 2];
const T29 = { a: [1], undefined: aliased29 };
function probe29(c) { const v = T29[c.k]; v[0] = 's'; return 0; }
class S29 { static r = probe29(this); static k = 'a'; }
const first29 = S29.r;
console.log('element-store-alias', String(first29), typeof first29, String(probe29(S29)), String(aliased29[0] + 1));
// delete-alias
const aliased30 = { x: 1 };
const T30 = { a: { x: 1 }, undefined: aliased30 };
function probe30(c) { const v = T30[c.k]; delete v.x; return 0; }
class S30 { static r = probe30(this); static k = 'a'; }
const first30 = S30.r;
console.log('delete-alias', String(first30), typeof first30, String(probe30(S30)), String(aliased30.x));
// freeze-alias
const aliased31 = { x: 1 };
const T31 = { a: { x: 1 }, undefined: aliased31 };
function probe31(c) { const v = T31[c.k]; Object.freeze(v); return 0; }
class S31 { static r = probe31(this); static k = 'a'; }
const first31 = S31.r;
console.log('freeze-alias', String(first31), typeof first31, String(probe31(S31)), String((() => { try { aliased31.x = 2; } catch { return 'threw'; } return aliased31.x; })()));
// define-alias
const aliased32 = { x: 1 };
const T32 = { a: { x: 1 }, undefined: aliased32 };
function probe32(c) { const v = T32[c.k]; Object.defineProperty(v, 'x', { get() { return 'late'; } }); return 0; }
class S32 { static r = probe32(this); static k = 'a'; }
const first32 = S32.r;
console.log('define-alias', String(first32), typeof first32, String(probe32(S32)), String(aliased32.x));
// length-alias
const aliased33 = [1, 2];
const T33 = { a: [1], undefined: aliased33 };
function probe33(c) { const v = T33[c.k]; v.length = 0; return 0; }
class S33 { static r = probe33(this); static k = 'a'; }
const first33 = S33.r;
console.log('length-alias', String(first33), typeof first33, String(probe33(S33)), String(aliased33.length + ':' + aliased33[0]));
// push-alias
const aliased34 = [1, 2];
const T34 = { a: [1], undefined: aliased34 };
function probe34(c) { const v = T34[c.k]; v.push('s'); return 0; }
class S34 { static r = probe34(this); static k = 'a'; }
const first34 = S34.r;
console.log('push-alias', String(first34), typeof first34, String(probe34(S34)), String(aliased34[2] + 1));
// map-set-alias
const aliased35 = new Map([['k', 1]]);
const T35 = { a: new Map(), undefined: aliased35 };
function probe35(c) { const v = T35[c.k]; v.set('k', 's'); return 0; }
class S35 { static r = probe35(this); static k = 'a'; }
const first35 = S35.r;
console.log('map-set-alias', String(first35), typeof first35, String(probe35(S35)), String(aliased35.get('k') + 1));
// add-property-alias
const aliased36 = { x: 1 };
const T36 = { a: { x: 1 }, undefined: aliased36 };
function probe36(c) { const v = T36[c.k]; v.added = 's'; return 0; }
class S36 { static r = probe36(this); static k = 'a'; }
const first36 = S36.r;
console.log('add-property-alias', String(first36), typeof first36, String(probe36(S36)), String(Object.keys(aliased36).join() + aliased36.added));
// set-prototype-alias
const aliased37 = { x: 1 };
const T37 = { a: { x: 1 }, undefined: aliased37 };
function probe37(c) { const v = T37[c.k]; Object.setPrototypeOf(v, { inherited: 'late' }); return 0; }
class S37 { static r = probe37(this); static k = 'a'; }
const first37 = S37.r;
console.log('set-prototype-alias', String(first37), typeof first37, String(probe37(S37)), String(aliased37.inherited));
// static-count
class Late38 { static n = 1; }
const T38 = { a: class { static n = 1; }, undefined: Late38 };
function probe38(c) { const v = T38[c.k]; v.n += 's'; return 0; }
class S38 { static r = probe38(this); static k = 'a'; }
const first38 = S38.r;
console.log('static-count', String(first38), typeof first38, String(probe38(S38)), String(Late38.n + 1));
// prototype-method-store
class Late39 { m() { return 1; } }
const T39 = { a: class { m() { return 1; } }, undefined: Late39 };
function probe39(c) { const v = T39[c.k]; v.prototype.m = () => 'late'; return 0; }
class S39 { static r = probe39(this); static k = 'a'; }
const first39 = S39.r;
console.log('prototype-method-store', String(first39), typeof first39, String(probe39(S39)), String(new Late39().m()));
