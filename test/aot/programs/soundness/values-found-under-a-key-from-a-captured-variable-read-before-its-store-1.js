// Each table is read under a key that comes from a captured variable that is read before its store: the first read uses the key undefined, the second one "a".
// What the table holds under "undefined" differs from what it holds under "a" in a way its use can tell. Each line prints both uses and what they left behind.
// call
const T0 = { a: () => 1, undefined: () => 'late' };
function outer0() { const probe = () => { const v = T0[k]; return v(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first0, second0] = outer0();
console.log('call', String(first0), typeof first0, String(second0), String(0));
// call-writes-variable
let once1 = 1;
const T1 = { a: () => 1, undefined: () => { once1 = 2; return 0; } };
function outer1() { const probe = () => { const v = T1[k]; return v(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first1, second1] = outer1();
console.log('call-writes-variable', String(first1), typeof first1, String(second1), String(once1 + 1));
// call-argument
const T2 = { a: x => x + 1, undefined: x => x + 's' };
function outer2() { const probe = () => { const v = T2[k]; return v(1); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first2, second2] = outer2();
console.log('call-argument', String(first2), typeof first2, String(second2), String(0));
// new
const T3 = { a: class { constructor() { this.tag = 1; } }, undefined: class { constructor() { this.other = 0; this.tag = 'late'; } } };
function outer3() { const probe = () => { const v = T3[k]; return new v().tag; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first3, second3] = outer3();
console.log('new', String(first3), typeof first3, String(second3), String(0));
// method
const T4 = { a: { m() { return 1; } }, undefined: { z: 0, m() { return 'late'; } } };
function outer4() { const probe = () => { const v = T4[k]; return v.m(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first4, second4] = outer4();
console.log('method', String(first4), typeof first4, String(second4), String(0));
// getter
let side5 = 0;
const T5 = { a: { g: 1 }, undefined: { get g() { side5++; return 'late'; } } };
function outer5() { const probe = () => { const v = T5[k]; return v.g; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first5, second5] = outer5();
console.log('getter', String(first5), typeof first5, String(second5), String(side5));
// setter
let side6 = 0;
const T6 = { a: { s: 1 }, undefined: { set s(x) { side6 = x; } } };
function outer6() { const probe = () => { const v = T6[k]; v.s = 5; return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first6, second6] = outer6();
console.log('setter', String(first6), typeof first6, String(second6), String(side6 + 1));
// slot
const T7 = { a: { x: 1 }, undefined: { y: 0, w: 2, x: 'late' } };
function outer7() { const probe = () => { const v = T7[k]; return v.x; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first7, second7] = outer7();
console.log('slot', String(first7), typeof first7, String(second7), String(0));
// slot-number
const T8 = { a: { x: 1 }, undefined: { y: 0, x: 1.5 } };
function outer8() { const probe = () => { const v = T8[k]; return v.x + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first8, second8] = outer8();
console.log('slot-number', String(first8), typeof first8, String(second8), String(0));
// for-of
const T9 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'late'; } } };
function outer9() { const probe = () => { const v = T9[k]; let r = ''; for (const x of v) r += x; return r; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first9, second9] = outer9();
console.log('for-of', String(first9), typeof first9, String(second9), String(0));
// for-of-set
const T10 = { a: [1, 2], undefined: new Set(['late']) };
function outer10() { const probe = () => { const v = T10[k]; let r = ''; for (const x of v) r += x; return r; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first10, second10] = outer10();
console.log('for-of-set', String(first10), typeof first10, String(second10), String(0));
// for-of-string
const T11 = { a: [1, 2], undefined: 'late' };
function outer11() { const probe = () => { const v = T11[k]; let r = ''; for (const x of v) r += x + '.'; return r; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first11, second11] = outer11();
console.log('for-of-string', String(first11), typeof first11, String(second11), String(0));
// for-of-return
let side12 = 0;
const T12 = { a: [1, 2], undefined: { [Symbol.iterator]() { return { next() { return { done: false, value: 'late' }; }, return() { side12++; return {}; } }; } } };
function outer12() { const probe = () => { const v = T12[k]; for (const x of v) return x; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first12, second12] = outer12();
console.log('for-of-return', String(first12), typeof first12, String(second12), String(side12));
// spread
const T13 = { a: [1, 2], undefined: new Set(['late']) };
function outer13() { const probe = () => { const v = T13[k]; return [...v].join(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first13, second13] = outer13();
console.log('spread', String(first13), typeof first13, String(second13), String(0));
// spread-call
const T14 = { a: [1, 2], undefined: { *[Symbol.iterator]() { yield 'la'; yield 'te'; } } };
function outer14() { const probe = () => { const v = T14[k]; return ((a, b) => a + b)(...v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first14, second14] = outer14();
console.log('spread-call', String(first14), typeof first14, String(second14), String(0));
// destructure-array
const T15 = { a: [1, 2], undefined: 'late' };
function outer15() { const probe = () => { const v = T15[k]; const [a, b] = v; return a + b; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first15, second15] = outer15();
console.log('destructure-array', String(first15), typeof first15, String(second15), String(0));
// destructure-object
const T16 = { a: { p: 1 }, undefined: { q: 0, get p() { return 'late'; } } };
function outer16() { const probe = () => { const v = T16[k]; const { p } = v; return p; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first16, second16] = outer16();
console.log('destructure-object', String(first16), typeof first16, String(second16), String(0));
// to-primitive
let side17 = 0;
const T17 = { a: 1, undefined: { valueOf() { side17++; return 'late'; } } };
function outer17() { const probe = () => { const v = T17[k]; return v + 1; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first17, second17] = outer17();
console.log('to-primitive', String(first17), typeof first17, String(second17), String(side17));
// to-primitive-symbol
const T18 = { a: 1, undefined: { [Symbol.toPrimitive]() { return 'late'; } } };
function outer18() { const probe = () => { const v = T18[k]; return `${v}`; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first18, second18] = outer18();
console.log('to-primitive-symbol', String(first18), typeof first18, String(second18), String(0));
// to-string
const T19 = { a: 'e', undefined: { toString() { return 'late'; } } };
function outer19() { const probe = () => { const v = T19[k]; return String(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first19, second19] = outer19();
console.log('to-string', String(first19), typeof first19, String(second19), String(0));
// to-number
const T20 = { a: 1, undefined: { valueOf() { return 2.5; } } };
function outer20() { const probe = () => { const v = T20[k]; return v * 2; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first20, second20] = outer20();
console.log('to-number', String(first20), typeof first20, String(second20), String(0));
// to-json
const T21 = { a: { a: 1 }, undefined: { toJSON() { return 'late'; } } };
function outer21() { const probe = () => { const v = T21[k]; return JSON.stringify(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first21, second21] = outer21();
console.log('to-json', String(first21), typeof first21, String(second21), String(0));
// to-key
let side22 = 0;
const T22 = { a: 'p', undefined: { toString() { side22++; return 'q'; } } };
function outer22() { const probe = () => { const v = T22[k]; return ({ p: 1, q: 'late' })[v]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first22, second22] = outer22();
console.log('to-key', String(first22), typeof first22, String(second22), String(side22));
// instanceof-right
let side23 = 0;
const T23 = { a: class A23 {}, undefined: { [Symbol.hasInstance]() { side23++; return true; } } };
function outer23() { const probe = () => { const v = T23[k]; return ({}) instanceof v; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first23, second23] = outer23();
console.log('instanceof-right', String(first23), typeof first23, String(second23), String(side23));
// instanceof-left
class A24 {} class B24 {}
const T24 = { a: new A24(), undefined: new B24() };
function outer24() { const probe = () => { const v = T24[k]; return v instanceof A24; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first24, second24] = outer24();
console.log('instanceof-left', String(first24), typeof first24, String(second24), String(0));
// extends
const T25 = { a: class { tag() { return 1; } }, undefined: class { tag() { return 'late'; } } };
function outer25() { const probe = () => { const v = T25[k]; class X extends v {} return new X().tag(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first25, second25] = outer25();
console.log('extends', String(first25), typeof first25, String(second25), String(0));
// extends-constructor
const T26 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.u = 0; this.t = 'late'; } } };
function outer26() { const probe = () => { const v = T26[k]; class X extends v { constructor() { super(); this.z = 3; } } return new X().t; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first26, second26] = outer26();
console.log('extends-constructor', String(first26), typeof first26, String(second26), String(0));
// object-create
const T27 = { a: { tag: 1 }, undefined: { get tag() { return 'late'; } } };
function outer27() { const probe = () => { const v = T27[k]; return Object.create(v).tag; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first27, second27] = outer27();
console.log('object-create', String(first27), typeof first27, String(second27), String(0));
// set-prototype
const T28 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function outer28() { const probe = () => { const v = T28[k]; const o = {}; Object.setPrototypeOf(o, v); return o.tag; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first28, second28] = outer28();
console.log('set-prototype', String(first28), typeof first28, String(second28), String(0));
// proto-literal
const T29 = { a: { tag: 1 }, undefined: { tag: 'late' } };
function outer29() { const probe = () => { const v = T29[k]; return ({ __proto__: v }).tag; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first29, second29] = outer29();
console.log('proto-literal', String(first29), typeof first29, String(second29), String(0));
// reflect-get
const T30 = { a: { g: 1 }, undefined: { get g() { return 'late'; } } };
function outer30() { const probe = () => { const v = T30[k]; return Reflect.get(v, 'g'); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first30, second30] = outer30();
console.log('reflect-get', String(first30), typeof first30, String(second30), String(0));
// reflect-apply
const T31 = { a: () => 1, undefined: () => 'late' };
function outer31() { const probe = () => { const v = T31[k]; return Reflect.apply(v, null, []); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first31, second31] = outer31();
console.log('reflect-apply', String(first31), typeof first31, String(second31), String(0));
// reflect-construct
const T32 = { a: class { constructor() { this.t = 1; } }, undefined: class { constructor() { this.t = 'late'; } } };
function outer32() { const probe = () => { const v = T32[k]; return Reflect.construct(v, []).t; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first32, second32] = outer32();
console.log('reflect-construct', String(first32), typeof first32, String(second32), String(0));
// map-callback
const T33 = { a: x => x, undefined: x => 'late' + x };
function outer33() { const probe = () => { const v = T33[k]; return [1, 2].map(v).join(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first33, second33] = outer33();
console.log('map-callback', String(first33), typeof first33, String(second33), String(0));
// foreach-callback
let side34 = 0;
const T34 = { a: x => {}, undefined: x => { side34 += x; } };
function outer34() { const probe = () => { const v = T34[k]; [1, 2].forEach(v); return 0; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first34, second34] = outer34();
console.log('foreach-callback', String(first34), typeof first34, String(second34), String(side34));
// sort-callback
const T35 = { a: (a, b) => a - b, undefined: (a, b) => b - a };
function outer35() { const probe = () => { const v = T35[k]; return [1, 3, 2].sort(v).join(); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first35, second35] = outer35();
console.log('sort-callback', String(first35), typeof first35, String(second35), String(0));
// reduce-callback
const T36 = { a: (a, b) => a + b, undefined: (a, b) => a + 's' + b };
function outer36() { const probe = () => { const v = T36[k]; return [1, 2].reduce(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first36, second36] = outer36();
console.log('reduce-callback', String(first36), typeof first36, String(second36), String(0));
// filter-callback
const T37 = { a: x => true, undefined: x => x > 1 };
function outer37() { const probe = () => { const v = T37[k]; return [1, 2].filter(v).length; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first37, second37] = outer37();
console.log('filter-callback', String(first37), typeof first37, String(second37), String(0));
// find-callback
const T38 = { a: x => x == 1, undefined: x => x == 2 };
function outer38() { const probe = () => { const v = T38[k]; return [1, 2].find(v); }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first38, second38] = outer38();
console.log('find-callback', String(first38), typeof first38, String(second38), String(0));
// array-from-callback
const T39 = { a: x => x, undefined: x => 'late' };
function outer39() { const probe = () => { const v = T39[k]; return Array.from([1], v)[0]; }; const first = probe(); var k = 'a'; return [first, probe()]; }
const [first39, second39] = outer39();
console.log('array-from-callback', String(first39), typeof first39, String(second39), String(0));
