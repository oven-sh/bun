// Each table is read under a key that comes from a field that is read before the constructor stores it: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// map-foreach-callback
let side0 = 0;
const T0 = { a: () => {}, undefined: (val, key) => { side0 = val; } };
let sink0;
function probe0() { const v = T0[sink0.k]; new Map([[1, 'late']]).forEach(v); return 0; }
class K0 { constructor() { sink0 = this; this.r = probe0(); this.k = 'a'; } }
const first0 = new K0().r;
console.log('map-foreach-callback', String(first0), typeof first0, String(probe0()), String(side0));
// replace-callback
const T1 = { a: () => 'e', undefined: () => 'late' };
let sink1;
function probe1() { const v = T1[sink1.k]; return 'ab'.replace(/a/, v); }
class K1 { constructor() { sink1 = this; this.r = probe1(); this.k = 'a'; } }
const first1 = new K1().r;
console.log('replace-callback', String(first1), typeof first1, String(probe1()), String(0));
// json-reviver
const T2 = { a: (k, x) => x, undefined: (k, x) => typeof x == 'number' ? 'late' : x };
let sink2;
function probe2() { const v = T2[sink2.k]; return JSON.parse('[1]', v)[0]; }
class K2 { constructor() { sink2 = this; this.r = probe2(); this.k = 'a'; } }
const first2 = new K2().r;
console.log('json-reviver', String(first2), typeof first2, String(probe2()), String(0));
// promise-executor
let side3 = 0;
const T3 = { a: r => {}, undefined: r => { side3 = 'late'; } };
let sink3;
function probe3() { const v = T3[sink3.k]; new Promise(v); return 0; }
class K3 { constructor() { sink3 = this; this.r = probe3(); this.k = 'a'; } }
const first3 = new K3().r;
console.log('promise-executor', String(first3), typeof first3, String(probe3()), String(side3));
// function-call
const T4 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
let sink4;
function probe4() { const v = T4[sink4.k]; return v.call(null); }
class K4 { constructor() { sink4 = this; this.r = probe4(); this.k = 'a'; } }
const first4 = new K4().r;
console.log('function-call', String(first4), typeof first4, String(probe4()), String(0));
// function-apply
const T5 = { a: function (a) { return a; }, undefined: function (a) { return 'late' + a; } };
let sink5;
function probe5() { const v = T5[sink5.k]; return v.apply(null, [1]); }
class K5 { constructor() { sink5 = this; this.r = probe5(); this.k = 'a'; } }
const first5 = new K5().r;
console.log('function-apply', String(first5), typeof first5, String(probe5()), String(0));
// function-bind
const T6 = { a: function () { return 1; }, undefined: function () { return 'late'; } };
let sink6;
function probe6() { const v = T6[sink6.k]; return v.bind(null)(); }
class K6 { constructor() { sink6 = this; this.r = probe6(); this.k = 'a'; } }
const first6 = new K6().r;
console.log('function-bind', String(first6), typeof first6, String(probe6()), String(0));
// yield-star
const T7 = { a: [1], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
let sink7;
function probe7() { const v = T7[sink7.k]; function* g() { yield* v; } return g().next().value; }
class K7 { constructor() { sink7 = this; this.r = probe7(); this.k = 'a'; } }
const first7 = new K7().r;
console.log('yield-star', String(first7), typeof first7, String(probe7()), String(0));
// for-in
const T8 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
let sink8;
function probe8() { const v = T8[sink8.k]; let r = ''; for (const k in v) r += k; return r; }
class K8 { constructor() { sink8 = this; this.r = probe8(); this.k = 'a'; } }
const first8 = new K8().r;
console.log('for-in', String(first8), typeof first8, String(probe8()), String(0));
// keys
const T9 = { a: { a: 1 }, undefined: { late: 1, more: 2 } };
let sink9;
function probe9() { const v = T9[sink9.k]; return Object.keys(v).join(); }
class K9 { constructor() { sink9 = this; this.r = probe9(); this.k = 'a'; } }
const first9 = new K9().r;
console.log('keys', String(first9), typeof first9, String(probe9()), String(0));
// values
const T10 = { a: { a: 1 }, undefined: { b: 'late' } };
let sink10;
function probe10() { const v = T10[sink10.k]; return Object.values(v)[0]; }
class K10 { constructor() { sink10 = this; this.r = probe10(); this.k = 'a'; } }
const first10 = new K10().r;
console.log('values', String(first10), typeof first10, String(probe10()), String(0));
// entries
const T11 = { a: { a: 1 }, undefined: { get b() { return 'late'; } } };
let sink11;
function probe11() { const v = T11[sink11.k]; return Object.entries(v)[0][1]; }
class K11 { constructor() { sink11 = this; this.r = probe11(); this.k = 'a'; } }
const first11 = new K11().r;
console.log('entries', String(first11), typeof first11, String(probe11()), String(0));
// assign
const T12 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
let sink12;
function probe12() { const v = T12[sink12.k]; return Object.assign({}, v).a; }
class K12 { constructor() { sink12 = this; this.r = probe12(); this.k = 'a'; } }
const first12 = new K12().r;
console.log('assign', String(first12), typeof first12, String(probe12()), String(0));
// object-spread
const T13 = { a: { a: 1 }, undefined: { get a() { return 'late'; } } };
let sink13;
function probe13() { const v = T13[sink13.k]; return ({ ...v }).a; }
class K13 { constructor() { sink13 = this; this.r = probe13(); this.k = 'a'; } }
const first13 = new K13().r;
console.log('object-spread', String(first13), typeof first13, String(probe13()), String(0));
// in-proxy
let side14 = 0;
const T14 = { a: { x: 1 }, undefined: new Proxy({}, { has() { side14++; return false; } }) };
let sink14;
function probe14() { const v = T14[sink14.k]; return 'x' in v; }
class K14 { constructor() { sink14 = this; this.r = probe14(); this.k = 'a'; } }
const first14 = new K14().r;
console.log('in-proxy', String(first14), typeof first14, String(probe14()), String(side14));
// proxy-handler
const T15 = { a: {}, undefined: { get() { return 'late'; } } };
let sink15;
function probe15() { const v = T15[sink15.k]; return new Proxy({ foo: 1 }, v).foo; }
class K15 { constructor() { sink15 = this; this.r = probe15(); this.k = 'a'; } }
const first15 = new K15().r;
console.log('proxy-handler', String(first15), typeof first15, String(probe15()), String(0));
// tagged-template
const T16 = { a: () => 1, undefined: s => 'late' + s[0] };
let sink16;
function probe16() { const v = T16[sink16.k]; return v`x`; }
class K16 { constructor() { sink16 = this; this.r = probe16(); this.k = 'a'; } }
const first16 = new K16().r;
console.log('tagged-template', String(first16), typeof first16, String(probe16()), String(0));
// typeof
const T17 = { a: 1, undefined: 'late' };
let sink17;
function probe17() { const v = T17[sink17.k]; return typeof v; }
class K17 { constructor() { sink17 = this; this.r = probe17(); this.k = 'a'; } }
const first17 = new K17().r;
console.log('typeof', String(first17), typeof first17, String(probe17()), String(0));
// typeof-function
const T18 = { a: () => 1, undefined: {} };
let sink18;
function probe18() { const v = T18[sink18.k]; return typeof v === 'function'; }
class K18 { constructor() { sink18 = this; this.r = probe18(); this.k = 'a'; } }
const first18 = new K18().r;
console.log('typeof-function', String(first18), typeof first18, String(probe18()), String(0));
// is-array
const T19 = { a: [1], undefined: { length: 1 } };
let sink19;
function probe19() { const v = T19[sink19.k]; return Array.isArray(v); }
class K19 { constructor() { sink19 = this; this.r = probe19(); this.k = 'a'; } }
const first19 = new K19().r;
console.log('is-array', String(first19), typeof first19, String(probe19()), String(0));
// identity
const same20 = { x: 1 };
const T20 = { a: same20, undefined: { x: 1 } };
let sink20;
function probe20() { const v = T20[sink20.k]; return v === same20; }
class K20 { constructor() { sink20 = this; this.r = probe20(); this.k = 'a'; } }
const first20 = new K20().r;
console.log('identity', String(first20), typeof first20, String(probe20()), String(0));
// nullish
const T21 = { a: 1, undefined: null };
let sink21;
function probe21() { const v = T21[sink21.k]; return v ?? 'late'; }
class K21 { constructor() { sink21 = this; this.r = probe21(); this.k = 'a'; } }
const first21 = new K21().r;
console.log('nullish', String(first21), typeof first21, String(probe21()), String(0));
// truthy
const T22 = { a: 1, undefined: 0 };
let sink22;
function probe22() { const v = T22[sink22.k]; return v ? 'e' : 'late'; }
class K22 { constructor() { sink22 = this; this.r = probe22(); this.k = 'a'; } }
const first22 = new K22().r;
console.log('truthy', String(first22), typeof first22, String(probe22()), String(0));
// optional-call
const T23 = { a: () => 1, undefined: undefined };
let sink23;
function probe23() { const v = T23[sink23.k]; return v?.(); }
class K23 { constructor() { sink23 = this; this.r = probe23(); this.k = 'a'; } }
const first23 = new K23().r;
console.log('optional-call', String(first23), typeof first23, String(probe23()), String(0));
// constructor-identity
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
let sink24;
function probe24() { const v = T24[sink24.k]; return v.constructor === A24; }
class K24 { constructor() { sink24 = this; this.r = probe24(); this.k = 'a'; } }
const first24 = new K24().r;
console.log('constructor-identity', String(first24), typeof first24, String(probe24()), String(0));
// prototype-identity
class A25 {} class B25 {}
const T25 = { a: new A25(), undefined: new B25() };
let sink25;
function probe25() { const v = T25[sink25.k]; return Object.getPrototypeOf(v) === A25.prototype; }
class K25 { constructor() { sink25 = this; this.r = probe25(); this.k = 'a'; } }
const first25 = new K25().r;
console.log('prototype-identity', String(first25), typeof first25, String(probe25()), String(0));
// has-own
const T26 = { a: { x: 1 }, undefined: { y: 1 } };
let sink26;
function probe26() { const v = T26[sink26.k]; return Object.hasOwn(v, 'x'); }
class K26 { constructor() { sink26 = this; this.r = probe26(); this.k = 'a'; } }
const first26 = new K26().r;
console.log('has-own', String(first26), typeof first26, String(probe26()), String(0));
// in
const T27 = { a: { x: 1 }, undefined: { y: 1 } };
let sink27;
function probe27() { const v = T27[sink27.k]; return 'x' in v; }
class K27 { constructor() { sink27 = this; this.r = probe27(); this.k = 'a'; } }
const first27 = new K27().r;
console.log('in', String(first27), typeof first27, String(probe27()), String(0));
// store-alias
const aliased28 = { x: 1 };
const T28 = { a: { x: 1 }, undefined: aliased28 };
let sink28;
function probe28() { const v = T28[sink28.k]; v.x = 's'; return 0; }
class K28 { constructor() { sink28 = this; this.r = probe28(); this.k = 'a'; } }
const first28 = new K28().r;
console.log('store-alias', String(first28), typeof first28, String(probe28()), String(aliased28.x + 1));
// element-store-alias
const aliased29 = [1, 2];
const T29 = { a: [1], undefined: aliased29 };
let sink29;
function probe29() { const v = T29[sink29.k]; v[0] = 's'; return 0; }
class K29 { constructor() { sink29 = this; this.r = probe29(); this.k = 'a'; } }
const first29 = new K29().r;
console.log('element-store-alias', String(first29), typeof first29, String(probe29()), String(aliased29[0] + 1));
// delete-alias
const aliased30 = { x: 1 };
const T30 = { a: { x: 1 }, undefined: aliased30 };
let sink30;
function probe30() { const v = T30[sink30.k]; delete v.x; return 0; }
class K30 { constructor() { sink30 = this; this.r = probe30(); this.k = 'a'; } }
const first30 = new K30().r;
console.log('delete-alias', String(first30), typeof first30, String(probe30()), String(aliased30.x));
// freeze-alias
const aliased31 = { x: 1 };
const T31 = { a: { x: 1 }, undefined: aliased31 };
let sink31;
function probe31() { const v = T31[sink31.k]; Object.freeze(v); return 0; }
class K31 { constructor() { sink31 = this; this.r = probe31(); this.k = 'a'; } }
const first31 = new K31().r;
console.log('freeze-alias', String(first31), typeof first31, String(probe31()), String((() => { try { aliased31.x = 2; } catch { return 'threw'; } return aliased31.x; })()));
// define-alias
const aliased32 = { x: 1 };
const T32 = { a: { x: 1 }, undefined: aliased32 };
let sink32;
function probe32() { const v = T32[sink32.k]; Object.defineProperty(v, 'x', { get() { return 'late'; } }); return 0; }
class K32 { constructor() { sink32 = this; this.r = probe32(); this.k = 'a'; } }
const first32 = new K32().r;
console.log('define-alias', String(first32), typeof first32, String(probe32()), String(aliased32.x));
// length-alias
const aliased33 = [1, 2];
const T33 = { a: [1], undefined: aliased33 };
let sink33;
function probe33() { const v = T33[sink33.k]; v.length = 0; return 0; }
class K33 { constructor() { sink33 = this; this.r = probe33(); this.k = 'a'; } }
const first33 = new K33().r;
console.log('length-alias', String(first33), typeof first33, String(probe33()), String(aliased33.length + ':' + aliased33[0]));
// push-alias
const aliased34 = [1, 2];
const T34 = { a: [1], undefined: aliased34 };
let sink34;
function probe34() { const v = T34[sink34.k]; v.push('s'); return 0; }
class K34 { constructor() { sink34 = this; this.r = probe34(); this.k = 'a'; } }
const first34 = new K34().r;
console.log('push-alias', String(first34), typeof first34, String(probe34()), String(aliased34[2] + 1));
// map-set-alias
const aliased35 = new Map([['k', 1]]);
const T35 = { a: new Map(), undefined: aliased35 };
let sink35;
function probe35() { const v = T35[sink35.k]; v.set('k', 's'); return 0; }
class K35 { constructor() { sink35 = this; this.r = probe35(); this.k = 'a'; } }
const first35 = new K35().r;
console.log('map-set-alias', String(first35), typeof first35, String(probe35()), String(aliased35.get('k') + 1));
// add-property-alias
const aliased36 = { x: 1 };
const T36 = { a: { x: 1 }, undefined: aliased36 };
let sink36;
function probe36() { const v = T36[sink36.k]; v.added = 's'; return 0; }
class K36 { constructor() { sink36 = this; this.r = probe36(); this.k = 'a'; } }
const first36 = new K36().r;
console.log('add-property-alias', String(first36), typeof first36, String(probe36()), String(Object.keys(aliased36).join() + aliased36.added));
// set-prototype-alias
const aliased37 = { x: 1 };
const T37 = { a: { x: 1 }, undefined: aliased37 };
let sink37;
function probe37() { const v = T37[sink37.k]; Object.setPrototypeOf(v, { inherited: 'late' }); return 0; }
class K37 { constructor() { sink37 = this; this.r = probe37(); this.k = 'a'; } }
const first37 = new K37().r;
console.log('set-prototype-alias', String(first37), typeof first37, String(probe37()), String(aliased37.inherited));
// static-count
class Late38 { static n = 1; }
const T38 = { a: class { static n = 1; }, undefined: Late38 };
let sink38;
function probe38() { const v = T38[sink38.k]; v.n += 's'; return 0; }
class K38 { constructor() { sink38 = this; this.r = probe38(); this.k = 'a'; } }
const first38 = new K38().r;
console.log('static-count', String(first38), typeof first38, String(probe38()), String(Late38.n + 1));
// prototype-method-store
class Late39 { m() { return 1; } }
const T39 = { a: class { m() { return 1; } }, undefined: Late39 };
let sink39;
function probe39() { const v = T39[sink39.k]; v.prototype.m = () => 'late'; return 0; }
class K39 { constructor() { sink39 = this; this.r = probe39(); this.k = 'a'; } }
const first39 = new K39().r;
console.log('prototype-method-store', String(first39), typeof first39, String(probe39()), String(new Late39().m()));
