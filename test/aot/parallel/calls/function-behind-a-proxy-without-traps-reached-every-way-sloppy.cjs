// A sloppy function stands behind a proxy without traps and is reached in many ways, each beside one call that hands it a known receiver. It prints the receiver, the arguments and new.target that each way hands it.
const { EventEmitter } = require('node:events');
module.exports = {};
const S = { name: 'self', n: 1.5 }, O = { name: 'other', n: 2.5 };
function N() { }
function say(name, receiver, n, a, b, count, newTarget, target, callee) { console.log(name, receiver, n, a, b, count, newTarget === undefined ? 'call' : newTarget === target ? 'target' : newTarget === callee ? 'callee' : newTarget === N ? 'another' : typeof newTarget); }
function run(name, target, way) {
  for (let turn = 0; turn < 2; turn++) {
    try { const r = way(); console.log(name, 'gives', typeof r, r === null || typeof r !== 'object' ? String(r) : Object.getPrototypeOf(r) === target.prototype ? 'of the target' : Object.getPrototypeOf(r) === N.prototype ? 'of another' : Array.isArray(r) ? 'list ' + r.length : 'object'); }
    catch (error) { console.log(name, 'throws', error.constructor.name); }
  }
}
process.on('uncaughtException', error => console.log('uncaught', error.constructor.name));
process.on('unhandledRejection', error => console.log('unhandled', typeof error === 'object' ? error.constructor.name : error));
function T1(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T1, F1); return 1; }
const F1 = new Proxy(T1, {}); T1.call(S, 'x', 'y');
const W1 = () => F1(1); run('bare', T1, W1);
function T2(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bare without arguments', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T2, F2); return 1; }
const F2 = new Proxy(T2, {}); T2.call(S, 'x', 'y');
const W2 = () => F2(); run('bare without arguments', T2, W2);
function T3(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('spread', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T3, F3); return 1; }
const F3 = new Proxy(T3, {}); T3.call(S, 'x', 'y');
const W3 = () => F3(...[1, 2]); run('spread', T3, W3);
function T4(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('optional', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T4, F4); return 1; }
const F4 = new Proxy(T4, {}); T4.call(S, 'x', 'y');
const W4 = () => F4?.(1); run('optional', T4, W4);
function T5(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('comma', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T5, F5); return 1; }
const F5 = new Proxy(T5, {}); T5.call(S, 'x', 'y');
const W5 = () => (0, { m: F5, n: 3 }.m)(1); run('comma', T5, W5);
function T6(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T6, F6); return 1; }
const F6 = new Proxy(T6, {}); T6.call(S, 'x', 'y');
const W6 = () => ({ m: F6, n: 3 }).m(1); run('method', T6, W6);
function T7(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('method under a key', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T7, F7); return 1; }
const F7 = new Proxy(T7, {}); T7.call(S, 'x', 'y');
const W7 = () => ({ m: F7, n: 3 })[String('m')](1); run('method under a key', T7, W7);
function T8(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T8, F8); return 1; }
const F8 = new Proxy(T8, {}); T8.call(S, 'x', 'y');
const W8 = () => F8`a${1}b`; run('tagged', T8, W8);
function T9(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('tagged method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T9, F9); return 1; }
const F9 = new Proxy(T9, {}); T9.call(S, 'x', 'y');
const W9 = () => ({ m: F9, n: 3 }).m`a${1}b`; run('tagged method', T9, W9);
function T10(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T10, F10); return 1; }
const F10 = new Proxy(T10, {}); T10.call(S, 'x', 'y');
const W10 = () => F10.call(O, 1); run('call', T10, W10);
function T11(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call of nothing', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T11, F11); return 1; }
const F11 = new Proxy(T11, {}); T11.call(S, 'x', 'y');
const W11 = () => F11.call(); run('call of nothing', T11, W11);
function T12(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call of a number', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T12, F12); return 1; }
const F12 = new Proxy(T12, {}); T12.call(S, 'x', 'y');
const W12 = () => F12.call(5, 1); run('call of a number', T12, W12);
function T13(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('apply', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T13, F13); return 1; }
const F13 = new Proxy(T13, {}); T13.call(S, 'x', 'y');
const W13 = () => F13.apply(O, [1, 2]); run('apply', T13, W13);
function T14(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('apply of nothing', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T14, F14); return 1; }
const F14 = new Proxy(T14, {}); T14.call(S, 'x', 'y');
const W14 = () => F14.apply(); run('apply of nothing', T14, W14);
function T15(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('apply of arguments', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T15, F15); return 1; }
const F15 = new Proxy(T15, {}); T15.call(S, 'x', 'y');
const W15 = () => (function () { return F15.apply(O, arguments); })(1, 2); run('apply of arguments', T15, W15);
function T16(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T16, F16); return 1; }
const F16 = new Proxy(T16, {}); T16.call(S, 'x', 'y');
const W16 = () => F16.bind(O)(1); run('bind', T16, W16);
function T17(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind of nothing', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T17, F17); return 1; }
const F17 = new Proxy(T17, {}); T17.call(S, 'x', 'y');
const W17 = () => F17.bind()(1); run('bind of nothing', T17, W17);
function T18(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind as a method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T18, F18); return 1; }
const F18 = new Proxy(T18, {}); T18.call(S, 'x', 'y');
const W18 = () => ({ m: F18.bind(O), n: 3 }).m(1); run('bind as a method', T18, W18);
function T19(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind of nothing as a method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T19, F19); return 1; }
const F19 = new Proxy(T19, {}); T19.call(S, 'x', 'y');
const W19 = () => ({ m: F19.bind(), n: 3 }).m(1); run('bind of nothing as a method', T19, W19);
function T20(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind twice', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T20, F20); return 1; }
const F20 = new Proxy(T20, {}); T20.call(S, 'x', 'y');
const W20 = () => F20.bind(O).bind(S)(1); run('bind twice', T20, W20);
function T21(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call of call', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T21, F21); return 1; }
const F21 = new Proxy(T21, {}); T21.call(S, 'x', 'y');
const W21 = () => Function.prototype.call.call(F21, O, 1); run('call of call', T21, W21);
function T22(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call of call without receiver', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T22, F22); return 1; }
const F22 = new Proxy(T22, {}); T22.call(S, 'x', 'y');
const W22 = () => Function.prototype.call.call(F22); run('call of call without receiver', T22, W22);
function T23(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('call of apply', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T23, F23); return 1; }
const F23 = new Proxy(T23, {}); T23.call(S, 'x', 'y');
const W23 = () => Function.prototype.apply.call(F23, O, [1]); run('call of apply', T23, W23);
function T24(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind of call', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T24, F24); return 1; }
const F24 = new Proxy(T24, {}); T24.call(S, 'x', 'y');
const W24 = () => Function.prototype.call.bind(F24)(O, 1); run('bind of call', T24, W24);
function T25(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('bind of call without receiver', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T25, F25); return 1; }
const F25 = new Proxy(T25, {}); T25.call(S, 'x', 'y');
const W25 = () => Function.prototype.call.bind(F25)(); run('bind of call without receiver', T25, W25);
function T26(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T26, F26); return 1; }
const F26 = new Proxy(T26, {}); T26.call(S, 'x', 'y');
const W26 = () => Reflect.apply(F26, O, [1]); run('reflect apply', T26, W26);
function T27(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of undefined', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T27, F27); return 1; }
const F27 = new Proxy(T27, {}); T27.call(S, 'x', 'y');
const W27 = () => Reflect.apply(F27, undefined, [1]); run('reflect apply of undefined', T27, W27);
function T28(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of a number', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T28, F28); return 1; }
const F28 = new Proxy(T28, {}); T28.call(S, 'x', 'y');
const W28 = () => Reflect.apply(F28, 5, []); run('reflect apply of a number', T28, W28);
function T29(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T29, F29); return 1; }
const F29 = new Proxy(T29, {}); T29.call(S, 'x', 'y');
const W29 = () => new F29(1); run('new', T29, W29);
function T30(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect construct', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T30, F30); return 1; }
const F30 = new Proxy(T30, {}); T30.call(S, 'x', 'y');
const W30 = () => Reflect.construct(F30, [1]); run('reflect construct', T30, W30);
function T31(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect construct for another', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T31, F31); return 1; }
const F31 = new Proxy(T31, {}); T31.call(S, 'x', 'y');
const W31 = () => Reflect.construct(F31, [1], N); run('reflect construct for another', T31, W31);
function T32(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect construct for itself', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T32, F32); return 1; }
const F32 = new Proxy(T32, {}); T32.call(S, 'x', 'y');
const W32 = () => Reflect.construct(F32, [1], F32); run('reflect construct for itself', T32, W32);
function T33(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect construct for the target', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T33, F33); return 1; }
const F33 = new Proxy(T33, {}); T33.call(S, 'x', 'y');
const W33 = () => Reflect.construct(F33, [1], T33); run('reflect construct for the target', T33, W33);
function T34(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect construct as new target', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T34, F34); return 1; }
const F34 = new Proxy(T34, {}); T34.call(S, 'x', 'y');
const W34 = () => Reflect.construct(N, [1], F34); run('reflect construct as new target', T34, W34);
function T35(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('new of bound', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T35, F35); return 1; }
const F35 = new Proxy(T35, {}); T35.call(S, 'x', 'y');
const W35 = () => new (F35.bind(O))(1); run('new of bound', T35, W35);
function T36(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('extends', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T36, F36); return 1; }
const F36 = new Proxy(T36, {}); T36.call(S, 'x', 'y');
const W36 = () => new (class extends F36 {})(1); run('extends', T36, W36);
function T37(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('extends with super', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T37, F37); return 1; }
const F37 = new Proxy(T37, {}); T37.call(S, 'x', 'y');
const W37 = () => new (class extends F37 { constructor() { super(1, 2); } })(); run('extends with super', T37, W37);
function T38(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T38, F38); return 1; }
const F38 = new Proxy(T38, {}); T38.call(S, 'x', 'y');
const W38 = () => [1].map(F38); run('map', T38, W38);
function T39(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('map for', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T39, F39); return 1; }
const F39 = new Proxy(T39, {}); T39.call(S, 'x', 'y');
const W39 = () => [1].map(F39, O); run('map for', T39, W39);
function T40(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('for each', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T40, F40); return 1; }
const F40 = new Proxy(T40, {}); T40.call(S, 'x', 'y');
const W40 = () => [1].forEach(F40); run('for each', T40, W40);
function T41(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reduce', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T41, F41); return 1; }
const F41 = new Proxy(T41, {}); T41.call(S, 'x', 'y');
const W41 = () => [1, 2].reduce(F41); run('reduce', T41, W41);
function T42(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('sort', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T42, F42); return 1; }
const F42 = new Proxy(T42, {}); T42.call(S, 'x', 'y');
const W42 = () => [2, 1].sort(F42); run('sort', T42, W42);
function T43(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('array from', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T43, F43); return 1; }
const F43 = new Proxy(T43, {}); T43.call(S, 'x', 'y');
const W43 = () => Array.from([1], F43); run('array from', T43, W43);
function T44(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('array from for', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T44, F44); return 1; }
const F44 = new Proxy(T44, {}); T44.call(S, 'x', 'y');
const W44 = () => Array.from([1], F44, O); run('array from for', T44, W44);
function T45(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('typed array map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T45, F45); return 1; }
const F45 = new Proxy(T45, {}); T45.call(S, 'x', 'y');
const W45 = () => new Uint8Array(1).map(F45); run('typed array map', T45, W45);
function T46(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('map for each', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T46, F46); return 1; }
const F46 = new Proxy(T46, {}); T46.call(S, 'x', 'y');
const W46 = () => new Map([[1, 2]]).forEach(F46); run('map for each', T46, W46);
function T47(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('iterator helper', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T47, F47); return 1; }
const F47 = new Proxy(T47, {}); T47.call(S, 'x', 'y');
const W47 = () => [1].values().map(F47).toArray(); run('iterator helper', T47, W47);
function T48(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('group by', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T48, F48); return 1; }
const F48 = new Proxy(T48, {}); T48.call(S, 'x', 'y');
const W48 = () => Object.groupBy([1], F48); run('group by', T48, W48);
function T49(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('array from async', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T49, F49); return 1; }
const F49 = new Proxy(T49, {}); T49.call(S, 'x', 'y');
const W49 = () => { Array.fromAsync([1], F49); }; run('array from async', T49, W49);
function T50(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('promise try', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T50, F50); return 1; }
const F50 = new Proxy(T50, {}); T50.call(S, 'x', 'y');
const W50 = () => { Promise.try(F50, 1); }; run('promise try', T50, W50);
function T51(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('map called', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T51, F51); return 1; }
const F51 = new Proxy(T51, {}); T51.call(S, 'x', 'y');
const W51 = () => Array.prototype.map.call([1], F51); run('map called', T51, W51);
function T52(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of call', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T52, F52); return 1; }
const F52 = new Proxy(T52, {}); T52.call(S, 'x', 'y');
const W52 = () => Reflect.apply(Function.prototype.call, F52, [O, 1]); run('reflect apply of call', T52, W52);
function T53(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of call without receiver', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T53, F53); return 1; }
const F53 = new Proxy(T53, {}); T53.call(S, 'x', 'y');
const W53 = () => Reflect.apply(Function.prototype.call, F53, []); run('reflect apply of call without receiver', T53, W53);
function T54(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of apply', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T54, F54); return 1; }
const F54 = new Proxy(T54, {}); T54.call(S, 'x', 'y');
const W54 = () => Reflect.apply(Function.prototype.apply, F54, [O, [1]]); run('reflect apply of apply', T54, W54);
function T55(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('reflect apply of bind', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T55, F55); return 1; }
const F55 = new Proxy(T55, {}); T55.call(S, 'x', 'y');
const W55 = () => Reflect.apply(Function.prototype.bind, F55, [O])(1); run('reflect apply of bind', T55, W55);
function T56(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('replace', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T56, F56); return 1; }
const F56 = new Proxy(T56, {}); T56.call(S, 'x', 'y');
const W56 = () => 'a'.replace('a', F56); run('replace', T56, W56);
function T57(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('json parse', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T57, F57); return 1; }
const F57 = new Proxy(T57, {}); T57.call(S, 'x', 'y');
const W57 = () => JSON.parse('[1]', F57); run('json parse', T57, W57);
function T58(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('json stringify', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T58, F58); return 1; }
const F58 = new Proxy(T58, {}); T58.call(S, 'x', 'y');
const W58 = () => JSON.stringify({ a: 1 }, F58); run('json stringify', T58, W58);
function T59(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('then', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T59, F59); return 1; }
const F59 = new Proxy(T59, {}); T59.call(S, 'x', 'y');
const W59 = () => { Promise.resolve(1).then(F59); }; run('then', T59, W59);
function T60(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('executor', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T60, F60); return 1; }
const F60 = new Proxy(T60, {}); T60.call(S, 'x', 'y');
const W60 = () => { new Promise(F60); }; run('executor', T60, W60);
function T61(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('microtask', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T61, F61); return 1; }
const F61 = new Proxy(T61, {}); T61.call(S, 'x', 'y');
const W61 = () => queueMicrotask(F61); run('microtask', T61, W61);
function T62(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next tick', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T62, F62); return 1; }
const F62 = new Proxy(T62, {}); T62.call(S, 'x', 'y');
const W62 = () => process.nextTick(F62, 1); run('next tick', T62, W62);
function T63(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('timeout', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T63, F63); return 1; }
const F63 = new Proxy(T63, {}); T63.call(S, 'x', 'y');
const W63 = () => { setTimeout(F63, 0, 1); }; run('timeout', T63, W63);
function T64(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('event listener', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T64, F64); return 1; }
const F64 = new Proxy(T64, {}); T64.call(S, 'x', 'y');
const W64 = () => { const t = new EventTarget(); t.addEventListener('x', F64); t.dispatchEvent(new Event('x')); }; run('event listener', T64, W64);
function T65(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('handle event', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T65, F65); return 1; }
const F65 = new Proxy(T65, {}); T65.call(S, 'x', 'y');
const W65 = () => { const t = new EventTarget(); t.addEventListener('x', { handleEvent: F65, n: 3 }); t.dispatchEvent(new Event('x')); }; run('handle event', T65, W65);
function T66(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('onabort', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T66, F66); return 1; }
const F66 = new Proxy(T66, {}); T66.call(S, 'x', 'y');
const W66 = () => { const c = new AbortController(); c.signal.onabort = F66; c.abort(); }; run('onabort', T66, W66);
function T67(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('emitter', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T67, F67); return 1; }
const F67 = new Proxy(T67, {}); T67.call(S, 'x', 'y');
const W67 = () => new EventEmitter().on('x', F67).emit('x', 1); run('emitter', T67, W67);
function T68(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T68, F68); return 1; }
const F68 = new Proxy(T68, {}); T68.call(S, 'x', 'y');
const W68 = () => Object.defineProperty({ n: 4 }, 'x', { get: F68, enumerable: true }).x; run('getter', T68, W68);
function T69(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter of an heir', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T69, F69); return 1; }
const F69 = new Proxy(T69, {}); T69.call(S, 'x', 'y');
const W69 = () => Object.create(Object.defineProperty({ n: 4 }, 'x', { get: F69, enumerable: true })).x; run('getter of an heir', T69, W69);
function T70(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter by reflect', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T70, F70); return 1; }
const F70 = new Proxy(T70, {}); T70.call(S, 'x', 'y');
const W70 = () => Reflect.get(Object.defineProperty({ n: 4 }, 'x', { get: F70, enumerable: true }), 'x', O); run('getter by reflect', T70, W70);
function T71(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter by reflect for a number', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T71, F71); return 1; }
const F71 = new Proxy(T71, {}); T71.call(S, 'x', 'y');
const W71 = () => Reflect.get(Object.defineProperty({ n: 4 }, 'x', { get: F71, enumerable: true }), 'x', 5); run('getter by reflect for a number', T71, W71);
function T72(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter of a number', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T72, F72); return 1; }
const F72 = new Proxy(T72, {}); T72.call(S, 'x', 'y');
const W72 = () => { Object.defineProperty(Number.prototype, 'getter of a number', { get: F72, configurable: true }); (5)['getter of a number']; delete Number.prototype['getter of a number']; }; run('getter of a number', T72, W72);
function T73(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter in a pattern', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T73, F73); return 1; }
const F73 = new Proxy(T73, {}); T73.call(S, 'x', 'y');
const W73 = () => { const { x } = Object.defineProperty({ n: 4 }, 'x', { get: F73, enumerable: true }); }; run('getter in a pattern', T73, W73);
function T74(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter in a spread', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T74, F74); return 1; }
const F74 = new Proxy(T74, {}); T74.call(S, 'x', 'y');
const W74 = () => ({ ...Object.defineProperty({ n: 4 }, 'x', { get: F74, enumerable: true }) }); run('getter in a spread', T74, W74);
function T75(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter in json', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T75, F75); return 1; }
const F75 = new Proxy(T75, {}); T75.call(S, 'x', 'y');
const W75 = () => JSON.stringify(Object.defineProperty({ n: 4 }, 'x', { get: F75, enumerable: true })); run('getter in json', T75, W75);
function T76(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter defined the old way', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T76, F76); return 1; }
const F76 = new Proxy(T76, {}); T76.call(S, 'x', 'y');
const W76 = () => { const o = { n: 4 }; o.__defineGetter__('x', F76); o.x; }; run('getter defined the old way', T76, W76);
function T77(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T77, F77); return 1; }
const F77 = new Proxy(T77, {}); T77.call(S, 'x', 'y');
const W77 = () => Object.defineProperty({ n: 4 }, 'x', { set: F77 }).x = 1; run('setter', T77, W77);
function T78(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter of an heir', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T78, F78); return 1; }
const F78 = new Proxy(T78, {}); T78.call(S, 'x', 'y');
const W78 = () => Object.create(Object.defineProperty({ n: 4 }, 'x', { set: F78 })).x = 1; run('setter of an heir', T78, W78);
function T79(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter by reflect', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T79, F79); return 1; }
const F79 = new Proxy(T79, {}); T79.call(S, 'x', 'y');
const W79 = () => Reflect.set(Object.defineProperty({ n: 4 }, 'x', { set: F79 }), 'x', 1, O); run('setter by reflect', T79, W79);
function T80(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter in assign', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T80, F80); return 1; }
const F80 = new Proxy(T80, {}); T80.call(S, 'x', 'y');
const W80 = () => Object.assign(Object.defineProperty({ n: 4 }, 'x', { set: F80 }), { x: 1 }); run('setter in assign', T80, W80);
function T81(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T81, F81); return { done: true, value: 1 }; }
const F81 = new Proxy(T81, {}); T81.call(S, 'x', 'y');
const W81 = () => { for (const v of { [Symbol.iterator]() { return { n: 5, next: F81 }; } }) { } }; run('next', T81, W81);
function T82(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next in a spread', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T82, F82); return { done: true, value: 1 }; }
const F82 = new Proxy(T82, {}); T82.call(S, 'x', 'y');
const W82 = () => [...{ [Symbol.iterator]() { return { n: 5, next: F82 }; } }]; run('next in a spread', T82, W82);
function T83(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next in a pattern', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T83, F83); return { done: true, value: 1 }; }
const F83 = new Proxy(T83, {}); T83.call(S, 'x', 'y');
const W83 = () => { const [v] = { [Symbol.iterator]() { return { n: 5, next: F83 }; } }; }; run('next in a pattern', T83, W83);
function T84(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next in array from', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T84, F84); return { done: true, value: 1 }; }
const F84 = new Proxy(T84, {}); T84.call(S, 'x', 'y');
const W84 = () => Array.from({ [Symbol.iterator]() { return { n: 5, next: F84 }; } }); run('next in array from', T84, W84);
function T85(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next in promise all', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T85, F85); return { done: true, value: 1 }; }
const F85 = new Proxy(T85, {}); T85.call(S, 'x', 'y');
const W85 = () => { Promise.all({ [Symbol.iterator]() { return { n: 5, next: F85 }; } }); }; run('next in promise all', T85, W85);
function T86(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next behind yield star', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T86, F86); return { done: true, value: 1 }; }
const F86 = new Proxy(T86, {}); T86.call(S, 'x', 'y');
const W86 = () => [...(function* () { yield* { [Symbol.iterator]() { return { n: 5, next: F86 }; } }; })()]; run('next behind yield star', T86, W86);
function T87(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('return of an iterator', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T87, F87); return { done: true, value: 1 }; }
const F87 = new Proxy(T87, {}); T87.call(S, 'x', 'y');
const W87 = () => { for (const v of { [Symbol.iterator]() { return { n: 5, next() { return { done: false, value: 1 }; }, return: F87 }; } }) break; }; run('return of an iterator', T87, W87);
function T88(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('iterator method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T88, F88); return [][Symbol.iterator](); }
const F88 = new Proxy(T88, {}); T88.call(S, 'x', 'y');
const W88 = () => { for (const v of { n: 6, [Symbol.iterator]: F88 }) { } }; run('iterator method', T88, W88);
function T89(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('async iterator method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T89, F89); return (async function* () { })(); }
const F89 = new Proxy(T89, {}); T89.call(S, 'x', 'y');
const W89 = () => { (async function () { for await (const v of { n: 6, [Symbol.asyncIterator]: F89 }) { } })(); }; run('async iterator method', T89, W89);
function T90(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('async next', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T90, F90); return { done: true, value: 1 }; }
const F90 = new Proxy(T90, {}); T90.call(S, 'x', 'y');
const W90 = () => { (async function () { for await (const v of { [Symbol.asyncIterator]() { return { n: 5, next: F90 }; } }) { } })(); }; run('async next', T90, W90);
function T91(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('to primitive', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T91, F91); return 1; }
const F91 = new Proxy(T91, {}); T91.call(S, 'x', 'y');
const W91 = () => `${{ n: 7, [Symbol.toPrimitive]: F91 }}`; run('to primitive', T91, W91);
function T92(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('value of', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T92, F92); return 1; }
const F92 = new Proxy(T92, {}); T92.call(S, 'x', 'y');
const W92 = () => +{ n: 7, valueOf: F92 }; run('value of', T92, W92);
function T93(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('to string', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T93, F93); return 1; }
const F93 = new Proxy(T93, {}); T93.call(S, 'x', 'y');
const W93 = () => String({ n: 7, toString: F93 }); run('to string', T93, W93);
function T94(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('to json', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T94, F94); return 1; }
const F94 = new Proxy(T94, {}); T94.call(S, 'x', 'y');
const W94 = () => JSON.stringify({ n: 7, toJSON: F94 }); run('to json', T94, W94);
function T95(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('has instance', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T95, F95); return 1; }
const F95 = new Proxy(T95, {}); T95.call(S, 'x', 'y');
const W95 = () => 1 instanceof { n: 7, [Symbol.hasInstance]: F95 }; run('has instance', T95, W95);
function T96(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('thenable', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T96, F96); return 1; }
const F96 = new Proxy(T96, {}); T96.call(S, 'x', 'y');
const W96 = () => { Promise.resolve({ n: 7, then: F96 }); }; run('thenable', T96, W96);
function T97(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('thenable awaited', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T97, F97); return 1; }
const F97 = new Proxy(T97, {}); T97.call(S, 'x', 'y');
const W97 = () => { (async function () { await Promise.race([{ n: 7, then: F97 }, 1]); })(); }; run('thenable awaited', T97, W97);
function T98(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('super method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T98, F98); return 1; }
const F98 = new Proxy(T98, {}); T98.call(S, 'x', 'y');
const W98 = () => { class A { } A.prototype.m = F98; class B extends A { n = 8; go() { return super.m(1); } } new B().go(); }; run('super method', T98, W98);
function T99(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('static member', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T99, F99); return 1; }
const F99 = new Proxy(T99, {}); T99.call(S, 'x', 'y');
const W99 = () => { class C { static m = F99; static n = 8; } C.m(1); }; run('static member', T99, W99);
function T100(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('field', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T100, F100); return 1; }
const F100 = new Proxy(T100, {}); T100.call(S, 'x', 'y');
const W100 = () => { class C { m = F100; n = 9; } new C().m(1); }; run('field', T100, W100);
function T101(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('prototype member', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T101, F101); return 1; }
const F101 = new Proxy(T101, {}); T101.call(S, 'x', 'y');
const W101 = () => { function C() { this.n = 10; } C.prototype.m = F101; new C().m(1); }; run('prototype member', T101, W101);
function T102(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('member of a number', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T102, F102); return 1; }
const F102 = new Proxy(T102, {}); T102.call(S, 'x', 'y');
const W102 = () => { Number.prototype['member of a number'] = F102; (5)['member of a number'](1); delete Number.prototype['member of a number']; }; run('member of a number', T102, W102);
function T103(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('member of the global', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T103, F103); return 1; }
const F103 = new Proxy(T103, {}); T103.call(S, 'x', 'y');
const W103 = () => { globalThis.G103 = F103; globalThis.G103(1); G103(1); delete globalThis.G103; }; run('member of the global', T103, W103);
function T104(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('element of a list', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T104, F104); return 1; }
const F104 = new Proxy(T104, {}); T104.call(S, 'x', 'y');
const W104 = () => { const list = [F104]; list[0](1); }; run('element of a list', T104, W104);
function T105(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('element of arguments', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T105, F105); return 1; }
const F105 = new Proxy(T105, {}); T105.call(S, 'x', 'y');
const W105 = () => (function () { return arguments[0](1); })(F105); run('element of arguments', T105, W105);
function T106(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('handed to a function', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T106, F106); return 1; }
const F106 = new Proxy(T106, {}); T106.call(S, 'x', 'y');
const W106 = () => (function (g) { return g(1); })(F106); run('handed to a function', T106, W106);
function T107(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('handed back', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T107, F107); return 1; }
const F107 = new Proxy(T107, {}); T107.call(S, 'x', 'y');
const W107 = () => (function () { return F107; })()(1); run('handed back', T107, W107);
function T108(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('method of a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T108, F108); return 1; }
const F108 = new Proxy(T108, {}); T108.call(S, 'x', 'y');
const W108 = () => new Proxy({ m: F108, n: 3 }, {}).m(1); run('method of a proxy', T108, W108);
function T109(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('method of a proxy that answers', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T109, F109); return 1; }
const F109 = new Proxy(T109, {}); T109.call(S, 'x', 'y');
const W109 = () => new Proxy({ m: F109, n: 3 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } }).m(1); run('method of a proxy that answers', T109, W109);
function T110(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('method of an heir of a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T110, F110); return 1; }
const F110 = new Proxy(T110, {}); T110.call(S, 'x', 'y');
const W110 = () => Object.create(new Proxy({ m: F110, n: 3 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })).m(1); run('method of an heir of a proxy', T110, W110);
function T111(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T111, F111); return 1; }
const F111 = new Proxy(T111, {}); T111.call(S, 'x', 'y');
const W111 = () => new Proxy(Object.defineProperty({ n: 4 }, 'x', { get: F111, enumerable: true }), {}).x; run('getter behind a proxy', T111, W111);
function T112(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter behind a proxy that answers', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T112, F112); return 1; }
const F112 = new Proxy(T112, {}); T112.call(S, 'x', 'y');
const W112 = () => new Proxy(Object.defineProperty({ n: 4 }, 'x', { get: F112, enumerable: true }), { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } }).x; run('getter behind a proxy that answers', T112, W112);
function T113(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter behind a proxy that reads its target', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T113, F113); return 1; }
const F113 = new Proxy(T113, {}); T113.call(S, 'x', 'y');
const W113 = () => new Proxy(Object.defineProperty({ n: 4 }, 'x', { get: F113, enumerable: true }), { get(t, k) { return k === 'n' ? 44 : t[k]; } }).x; run('getter behind a proxy that reads its target', T113, W113);
function T114(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter of an heir of a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T114, F114); return 1; }
const F114 = new Proxy(T114, {}); T114.call(S, 'x', 'y');
const W114 = () => Object.create(new Proxy(Object.defineProperty({ n: 4 }, 'x', { get: F114, enumerable: true }), { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })).x; run('getter of an heir of a proxy', T114, W114);
function T115(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('getter behind a proxy in a spread', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T115, F115); return 1; }
const F115 = new Proxy(T115, {}); T115.call(S, 'x', 'y');
const W115 = () => ({ ...new Proxy(Object.defineProperty({ n: 4 }, 'x', { get: F115, enumerable: true }), { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } }) }); run('getter behind a proxy in a spread', T115, W115);
function T116(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T116, F116); return 1; }
const F116 = new Proxy(T116, {}); T116.call(S, 'x', 'y');
const W116 = () => new Proxy(Object.defineProperty({ n: 4 }, 'x', { set: F116 }), {}).x = 1; run('setter behind a proxy', T116, W116);
function T117(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter behind a proxy that answers', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T117, F117); return 1; }
const F117 = new Proxy(T117, {}); T117.call(S, 'x', 'y');
const W117 = () => new Proxy(Object.defineProperty({ n: 4 }, 'x', { set: F117 }), { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } }).x = 1; run('setter behind a proxy that answers', T117, W117);
function T118(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('setter of an heir of a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T118, F118); return 1; }
const F118 = new Proxy(T118, {}); T118.call(S, 'x', 'y');
const W118 = () => Object.create(new Proxy(Object.defineProperty({ n: 4 }, 'x', { set: F118 }), { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })).x = 1; run('setter of an heir of a proxy', T118, W118);
function T119(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('iterator method behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T119, F119); return [][Symbol.iterator](); }
const F119 = new Proxy(T119, {}); T119.call(S, 'x', 'y');
const W119 = () => [...new Proxy({ n: 6, [Symbol.iterator]: F119 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })]; run('iterator method behind a proxy', T119, W119);
function T120(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('next behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T120, F120); return { done: true, value: 1 }; }
const F120 = new Proxy(T120, {}); T120.call(S, 'x', 'y');
const W120 = () => [...{ [Symbol.iterator]() { return new Proxy({ n: 5, next: F120 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } }); } }]; run('next behind a proxy', T120, W120);
function T121(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('to primitive behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T121, F121); return 1; }
const F121 = new Proxy(T121, {}); T121.call(S, 'x', 'y');
const W121 = () => `${new Proxy({ n: 7, [Symbol.toPrimitive]: F121 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })}`; run('to primitive behind a proxy', T121, W121);
function T122(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('to json behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T122, F122); return 1; }
const F122 = new Proxy(T122, {}); T122.call(S, 'x', 'y');
const W122 = () => JSON.stringify(new Proxy({ n: 7, toJSON: F122 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })); run('to json behind a proxy', T122, W122);
function T123(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('thenable behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T123, F123); return 1; }
const F123 = new Proxy(T123, {}); T123.call(S, 'x', 'y');
const W123 = () => { Promise.resolve(new Proxy({ n: 7, then: F123 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })); }; run('thenable behind a proxy', T123, W123);
function T124(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('handle event behind a proxy', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T124, F124); return 1; }
const F124 = new Proxy(T124, {}); T124.call(S, 'x', 'y');
const W124 = () => { const t = new EventTarget(); t.addEventListener('x', new Proxy({ handleEvent: F124, n: 3 }, { get(t, k, r) { return k === 'n' ? 44 : Reflect.get(t, k, r); } })); t.dispatchEvent(new Event('x')); }; run('handle event behind a proxy', T124, W124);
function T125(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap get', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T125, F125); return 1; }
const F125 = new Proxy(T125, {}); T125.call(S, 'x', 'y');
const W125 = () => new Proxy({}, { n: 13, get: F125 }).x; run('trap get', T125, W125);
function T126(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap set', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T126, F126); return 1; }
const F126 = new Proxy(T126, {}); T126.call(S, 'x', 'y');
const W126 = () => Reflect.set(new Proxy({}, { n: 13, set: F126 }), 'x', 1); run('trap set', T126, W126);
function T127(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap has', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T127, F127); return 1; }
const F127 = new Proxy(T127, {}); T127.call(S, 'x', 'y');
const W127 = () => 'x' in new Proxy({}, { n: 13, has: F127 }); run('trap has', T127, W127);
function T128(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap delete', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T128, F128); return 1; }
const F128 = new Proxy(T128, {}); T128.call(S, 'x', 'y');
const W128 = () => Reflect.deleteProperty(new Proxy({}, { n: 13, deleteProperty: F128 }), 'x'); run('trap delete', T128, W128);
function T129(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap own keys', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T129, F129); return []; }
const F129 = new Proxy(T129, {}); T129.call(S, 'x', 'y');
const W129 = () => Object.keys(new Proxy({}, { n: 13, ownKeys: F129 })); run('trap own keys', T129, W129);
function T130(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap descriptor', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T130, F130); return undefined; }
const F130 = new Proxy(T130, {}); T130.call(S, 'x', 'y');
const W130 = () => Object.getOwnPropertyDescriptor(new Proxy({}, { n: 13, getOwnPropertyDescriptor: F130 }), 'x'); run('trap descriptor', T130, W130);
function T131(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap define', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T131, F131); return 1; }
const F131 = new Proxy(T131, {}); T131.call(S, 'x', 'y');
const W131 = () => Reflect.defineProperty(new Proxy({}, { n: 13, defineProperty: F131 }), 'x', { value: 1, configurable: true }); run('trap define', T131, W131);
function T132(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap prototype', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T132, F132); return null; }
const F132 = new Proxy(T132, {}); T132.call(S, 'x', 'y');
const W132 = () => Object.getPrototypeOf(new Proxy({}, { n: 13, getPrototypeOf: F132 })); run('trap prototype', T132, W132);
function T133(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap set prototype', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T133, F133); return 1; }
const F133 = new Proxy(T133, {}); T133.call(S, 'x', 'y');
const W133 = () => Reflect.setPrototypeOf(new Proxy({}, { n: 13, setPrototypeOf: F133 }), null); run('trap set prototype', T133, W133);
function T134(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap extensible', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T134, F134); return true; }
const F134 = new Proxy(T134, {}); T134.call(S, 'x', 'y');
const W134 = () => Object.isExtensible(new Proxy({}, { n: 13, isExtensible: F134 })); run('trap extensible', T134, W134);
function T135(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap prevent', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T135, F135); return false; }
const F135 = new Proxy(T135, {}); T135.call(S, 'x', 'y');
const W135 = () => Reflect.preventExtensions(new Proxy({}, { n: 13, preventExtensions: F135 })); run('trap prevent', T135, W135);
function T136(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap apply', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T136, F136); return 1; }
const F136 = new Proxy(T136, {}); T136.call(S, 'x', 'y');
const W136 = () => new Proxy(function () { }, { n: 13, apply: F136 })(1); run('trap apply', T136, W136);
function T137(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap apply of a method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T137, F137); return 1; }
const F137 = new Proxy(T137, {}); T137.call(S, 'x', 'y');
const W137 = () => ({ m: new Proxy(function () { }, { n: 13, apply: F137 }), n: 3 }).m(1); run('trap apply of a method', T137, W137);
function T138(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('trap construct', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T138, F138); return {}; }
const F138 = new Proxy(T138, {}); T138.call(S, 'x', 'y');
const W138 = () => new (new Proxy(function () { }, { n: 13, construct: F138 }))(1); run('trap construct', T138, W138);
function T139(a, b) { let n; try { n = this.n; } catch { n = 'throws'; } say('with', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T139, F139); return 1; }
const F139 = new Proxy(T139, {}); T139.call(S, 'x', 'y');
const W139 = () => { with ({ m: F139, n: 11 }) { m(1); } }; run('with', T139, W139);
