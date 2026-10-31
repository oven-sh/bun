// A strict function is wrapped in proxies and bound functions of many kinds. Each is called without a receiver, as a method, by a built-in and with new, beside one call that hands the function a known receiver.
// @ts-nocheck
import { EventEmitter } from 'node:events';
const S: any = { name: 'self', n: 1.5 }, O: any = { name: 'other', n: 2.5 };
function N(this: any) { }
function say(name, receiver, n, a, b, count, newTarget, target, callee) { console.log(name, receiver, n, a, b, count, newTarget === undefined ? 'call' : newTarget === target ? 'target' : newTarget === callee ? 'callee' : newTarget === N ? 'another' : typeof newTarget); }
function run(name, target, way) {
  for (let turn = 0; turn < 2; turn++) {
    try { const r = way(); console.log(name, 'gives', typeof r, r === null || typeof r !== 'object' ? String(r) : Object.getPrototypeOf(r) === target.prototype ? 'of the target' : Object.getPrototypeOf(r) === N.prototype ? 'of another' : Array.isArray(r) ? 'list ' + r.length : 'object'); }
    catch (error) { console.log(name, 'throws', error.constructor.name); }
  }
}
process.on('uncaughtException', error => console.log('uncaught', error.constructor.name));
process.on('unhandledRejection', error => console.log('unhandled', typeof error === 'object' ? error.constructor.name : error));
function T1(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('function itself: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T1, F1); return 1; }
const F1: any = T1; T1.call(S, 'x', 'y');
const W1 = () => F1(1); run('function itself: bare', T1, W1);
function T2(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('function itself: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T2, F2); return 1; }
const F2: any = T2; T2.call(S, 'x', 'y');
const W2 = () => ({ m: F2, n: 3 }).m(1); run('function itself: method', T2, W2);
function T3(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('function itself: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T3, F3); return 1; }
const F3: any = T3; T3.call(S, 'x', 'y');
const W3 = () => F3`a${1}b`; run('function itself: tagged', T3, W3);
function T4(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('function itself: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T4, F4); return 1; }
const F4: any = T4; T4.call(S, 'x', 'y');
const W4 = () => new F4(1); run('function itself: new', T4, W4);
function T5(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('function itself: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T5, F5); return 1; }
const F5: any = T5; T5.call(S, 'x', 'y');
const W5 = () => [1].map(F5); run('function itself: map', T5, W5);
function T6(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T6, F6); return 1; }
const F6: any = new Proxy(T6, {}); T6.call(S, 'x', 'y');
const W6 = () => F6(1); run('proxy without traps: bare', T6, W6);
function T7(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T7, F7); return 1; }
const F7: any = new Proxy(T7, {}); T7.call(S, 'x', 'y');
const W7 = () => ({ m: F7, n: 3 }).m(1); run('proxy without traps: method', T7, W7);
function T8(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T8, F8); return 1; }
const F8: any = new Proxy(T8, {}); T8.call(S, 'x', 'y');
const W8 = () => F8`a${1}b`; run('proxy without traps: tagged', T8, W8);
function T9(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T9, F9); return 1; }
const F9: any = new Proxy(T9, {}); T9.call(S, 'x', 'y');
const W9 = () => new F9(1); run('proxy without traps: new', T9, W9);
function T10(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T10, F10); return 1; }
const F10: any = new Proxy(T10, {}); T10.call(S, 'x', 'y');
const W10 = () => [1].map(F10); run('proxy without traps: map', T10, W10);
function T11(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a proxy: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T11, F11); return 1; }
const F11: any = new Proxy(new Proxy(T11, {}), {}); T11.call(S, 'x', 'y');
const W11 = () => F11(1); run('proxy of a proxy: bare', T11, W11);
function T12(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a proxy: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T12, F12); return 1; }
const F12: any = new Proxy(new Proxy(T12, {}), {}); T12.call(S, 'x', 'y');
const W12 = () => ({ m: F12, n: 3 }).m(1); run('proxy of a proxy: method', T12, W12);
function T13(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a proxy: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T13, F13); return 1; }
const F13: any = new Proxy(new Proxy(T13, {}), {}); T13.call(S, 'x', 'y');
const W13 = () => F13`a${1}b`; run('proxy of a proxy: tagged', T13, W13);
function T14(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a proxy: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T14, F14); return 1; }
const F14: any = new Proxy(new Proxy(T14, {}), {}); T14.call(S, 'x', 'y');
const W14 = () => new F14(1); run('proxy of a proxy: new', T14, W14);
function T15(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a proxy: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T15, F15); return 1; }
const F15: any = new Proxy(new Proxy(T15, {}), {}); T15.call(S, 'x', 'y');
const W15 = () => [1].map(F15); run('proxy of a proxy: map', T15, W15);
function T16(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps hand on: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T16, F16); return 1; }
const F16: any = new Proxy(T16, { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T16.call(S, 'x', 'y');
const W16 = () => F16(1); run('proxy whose traps hand on: bare', T16, W16);
function T17(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps hand on: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T17, F17); return 1; }
const F17: any = new Proxy(T17, { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T17.call(S, 'x', 'y');
const W17 = () => ({ m: F17, n: 3 }).m(1); run('proxy whose traps hand on: method', T17, W17);
function T18(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps hand on: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T18, F18); return 1; }
const F18: any = new Proxy(T18, { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T18.call(S, 'x', 'y');
const W18 = () => F18`a${1}b`; run('proxy whose traps hand on: tagged', T18, W18);
function T19(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps hand on: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T19, F19); return 1; }
const F19: any = new Proxy(T19, { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T19.call(S, 'x', 'y');
const W19 = () => new F19(1); run('proxy whose traps hand on: new', T19, W19);
function T20(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps hand on: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T20, F20); return 1; }
const F20: any = new Proxy(T20, { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T20.call(S, 'x', 'y');
const W20 = () => [1].map(F20); run('proxy whose traps hand on: map', T20, W20);
function T21(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with a get trap: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T21, F21); return 1; }
const F21: any = new Proxy(T21, { get(t, k, r) { return Reflect.get(t, k, r); } }); T21.call(S, 'x', 'y');
const W21 = () => F21(1); run('proxy with a get trap: bare', T21, W21);
function T22(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with a get trap: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T22, F22); return 1; }
const F22: any = new Proxy(T22, { get(t, k, r) { return Reflect.get(t, k, r); } }); T22.call(S, 'x', 'y');
const W22 = () => ({ m: F22, n: 3 }).m(1); run('proxy with a get trap: method', T22, W22);
function T23(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with a get trap: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T23, F23); return 1; }
const F23: any = new Proxy(T23, { get(t, k, r) { return Reflect.get(t, k, r); } }); T23.call(S, 'x', 'y');
const W23 = () => F23`a${1}b`; run('proxy with a get trap: tagged', T23, W23);
function T24(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with a get trap: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T24, F24); return 1; }
const F24: any = new Proxy(T24, { get(t, k, r) { return Reflect.get(t, k, r); } }); T24.call(S, 'x', 'y');
const W24 = () => new F24(1); run('proxy with a get trap: new', T24, W24);
function T25(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with a get trap: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T25, F25); return 1; }
const F25: any = new Proxy(T25, { get(t, k, r) { return Reflect.get(t, k, r); } }); T25.call(S, 'x', 'y');
const W25 = () => [1].map(F25); run('proxy with a get trap: map', T25, W25);
function T26(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that answers another prototype: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T26, F26); return 1; }
const F26: any = new Proxy(T26, { get(t, k, r) { return k === 'prototype' ? N.prototype : Reflect.get(t, k, r); } }); T26.call(S, 'x', 'y');
const W26 = () => F26(1); run('proxy that answers another prototype: bare', T26, W26);
function T27(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that answers another prototype: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T27, F27); return 1; }
const F27: any = new Proxy(T27, { get(t, k, r) { return k === 'prototype' ? N.prototype : Reflect.get(t, k, r); } }); T27.call(S, 'x', 'y');
const W27 = () => ({ m: F27, n: 3 }).m(1); run('proxy that answers another prototype: method', T27, W27);
function T28(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that answers another prototype: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T28, F28); return 1; }
const F28: any = new Proxy(T28, { get(t, k, r) { return k === 'prototype' ? N.prototype : Reflect.get(t, k, r); } }); T28.call(S, 'x', 'y');
const W28 = () => F28`a${1}b`; run('proxy that answers another prototype: tagged', T28, W28);
function T29(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that answers another prototype: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T29, F29); return 1; }
const F29: any = new Proxy(T29, { get(t, k, r) { return k === 'prototype' ? N.prototype : Reflect.get(t, k, r); } }); T29.call(S, 'x', 'y');
const W29 = () => new F29(1); run('proxy that answers another prototype: new', T29, W29);
function T30(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that answers another prototype: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T30, F30); return 1; }
const F30: any = new Proxy(T30, { get(t, k, r) { return k === 'prototype' ? N.prototype : Reflect.get(t, k, r); } }); T30.call(S, 'x', 'y');
const W30 = () => [1].map(F30); run('proxy that answers another prototype: map', T30, W30);
function T31(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps choose: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T31, F31); return 1; }
const F31: any = new Proxy(T31, { apply(t, r, list) { return t.call(O, ...list); }, construct(t, list) { return new t(...list); } }); T31.call(S, 'x', 'y');
const W31 = () => F31(1); run('proxy whose traps choose: bare', T31, W31);
function T32(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps choose: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T32, F32); return 1; }
const F32: any = new Proxy(T32, { apply(t, r, list) { return t.call(O, ...list); }, construct(t, list) { return new t(...list); } }); T32.call(S, 'x', 'y');
const W32 = () => ({ m: F32, n: 3 }).m(1); run('proxy whose traps choose: method', T32, W32);
function T33(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps choose: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T33, F33); return 1; }
const F33: any = new Proxy(T33, { apply(t, r, list) { return t.call(O, ...list); }, construct(t, list) { return new t(...list); } }); T33.call(S, 'x', 'y');
const W33 = () => F33`a${1}b`; run('proxy whose traps choose: tagged', T33, W33);
function T34(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps choose: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T34, F34); return 1; }
const F34: any = new Proxy(T34, { apply(t, r, list) { return t.call(O, ...list); }, construct(t, list) { return new t(...list); } }); T34.call(S, 'x', 'y');
const W34 = () => new F34(1); run('proxy whose traps choose: new', T34, W34);
function T35(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps choose: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T35, F35); return 1; }
const F35: any = new Proxy(T35, { apply(t, r, list) { return t.call(O, ...list); }, construct(t, list) { return new t(...list); } }); T35.call(S, 'x', 'y');
const W35 = () => [1].map(F35); run('proxy whose traps choose: map', T35, W35);
function T36(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps drop: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T36, F36); return 1; }
const F36: any = new Proxy(T36, { apply(t, r, list) { return t(...list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T36.call(S, 'x', 'y');
const W36 = () => F36(1); run('proxy whose traps drop: bare', T36, W36);
function T37(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps drop: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T37, F37); return 1; }
const F37: any = new Proxy(T37, { apply(t, r, list) { return t(...list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T37.call(S, 'x', 'y');
const W37 = () => ({ m: F37, n: 3 }).m(1); run('proxy whose traps drop: method', T37, W37);
function T38(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps drop: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T38, F38); return 1; }
const F38: any = new Proxy(T38, { apply(t, r, list) { return t(...list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T38.call(S, 'x', 'y');
const W38 = () => F38`a${1}b`; run('proxy whose traps drop: tagged', T38, W38);
function T39(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps drop: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T39, F39); return 1; }
const F39: any = new Proxy(T39, { apply(t, r, list) { return t(...list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T39.call(S, 'x', 'y');
const W39 = () => new F39(1); run('proxy whose traps drop: new', T39, W39);
function T40(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose traps drop: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T40, F40); return 1; }
const F40: any = new Proxy(T40, { apply(t, r, list) { return t(...list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T40.call(S, 'x', 'y');
const W40 = () => [1].map(F40); run('proxy whose traps drop: map', T40, W40);
function T41(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that is revoked: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T41, F41); return 1; }
const R41: any = Proxy.revocable(T41, {}); const F41: any = R41.proxy; T41.call(S, 'x', 'y');
const W41 = () => F41(1); run('proxy that is revoked: bare', T41, W41); R41.revoke(); run('proxy that is revoked: bare', T41, W41);
function T42(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that is revoked: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T42, F42); return 1; }
const R42: any = Proxy.revocable(T42, {}); const F42: any = R42.proxy; T42.call(S, 'x', 'y');
const W42 = () => ({ m: F42, n: 3 }).m(1); run('proxy that is revoked: method', T42, W42); R42.revoke(); run('proxy that is revoked: method', T42, W42);
function T43(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that is revoked: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T43, F43); return 1; }
const R43: any = Proxy.revocable(T43, {}); const F43: any = R43.proxy; T43.call(S, 'x', 'y');
const W43 = () => F43`a${1}b`; run('proxy that is revoked: tagged', T43, W43); R43.revoke(); run('proxy that is revoked: tagged', T43, W43);
function T44(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that is revoked: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T44, F44); return 1; }
const R44: any = Proxy.revocable(T44, {}); const F44: any = R44.proxy; T44.call(S, 'x', 'y');
const W44 = () => new F44(1); run('proxy that is revoked: new', T44, W44); R44.revoke(); run('proxy that is revoked: new', T44, W44);
function T45(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that is revoked: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T45, F45); return 1; }
const R45: any = Proxy.revocable(T45, {}); const F45: any = R45.proxy; T45.call(S, 'x', 'y');
const W45 = () => [1].map(F45); run('proxy that is revoked: map', T45, W45); R45.revoke(); run('proxy that is revoked: map', T45, W45);
function T46(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that gets traps later: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T46, F46); return 1; }
const H46: any = {}; const F46: any = new Proxy(T46, H46); T46.call(S, 'x', 'y');
const W46 = () => F46(1); run('proxy that gets traps later: bare', T46, W46); H46.apply = function (t, r, list) { return Reflect.apply(t, O, list); }; H46.construct = function (t, list) { return Reflect.construct(t, list, N); }; run('proxy that gets traps later: bare', T46, W46);
function T47(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that gets traps later: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T47, F47); return 1; }
const H47: any = {}; const F47: any = new Proxy(T47, H47); T47.call(S, 'x', 'y');
const W47 = () => ({ m: F47, n: 3 }).m(1); run('proxy that gets traps later: method', T47, W47); H47.apply = function (t, r, list) { return Reflect.apply(t, O, list); }; H47.construct = function (t, list) { return Reflect.construct(t, list, N); }; run('proxy that gets traps later: method', T47, W47);
function T48(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that gets traps later: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T48, F48); return 1; }
const H48: any = {}; const F48: any = new Proxy(T48, H48); T48.call(S, 'x', 'y');
const W48 = () => F48`a${1}b`; run('proxy that gets traps later: tagged', T48, W48); H48.apply = function (t, r, list) { return Reflect.apply(t, O, list); }; H48.construct = function (t, list) { return Reflect.construct(t, list, N); }; run('proxy that gets traps later: tagged', T48, W48);
function T49(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that gets traps later: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T49, F49); return 1; }
const H49: any = {}; const F49: any = new Proxy(T49, H49); T49.call(S, 'x', 'y');
const W49 = () => new F49(1); run('proxy that gets traps later: new', T49, W49); H49.apply = function (t, r, list) { return Reflect.apply(t, O, list); }; H49.construct = function (t, list) { return Reflect.construct(t, list, N); }; run('proxy that gets traps later: new', T49, W49);
function T50(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that gets traps later: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T50, F50); return 1; }
const H50: any = {}; const F50: any = new Proxy(T50, H50); T50.call(S, 'x', 'y');
const W50 = () => [1].map(F50); run('proxy that gets traps later: map', T50, W50); H50.apply = function (t, r, list) { return Reflect.apply(t, O, list); }; H50.construct = function (t, list) { return Reflect.construct(t, list, N); }; run('proxy that gets traps later: map', T50, W50);
function T51(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that loses its traps: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T51, F51); return 1; }
const H51: any = { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }; const F51: any = new Proxy(T51, H51); T51.call(S, 'x', 'y');
const W51 = () => F51(1); run('proxy that loses its traps: bare', T51, W51); delete H51.apply; delete H51.construct; run('proxy that loses its traps: bare', T51, W51);
function T52(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that loses its traps: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T52, F52); return 1; }
const H52: any = { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }; const F52: any = new Proxy(T52, H52); T52.call(S, 'x', 'y');
const W52 = () => ({ m: F52, n: 3 }).m(1); run('proxy that loses its traps: method', T52, W52); delete H52.apply; delete H52.construct; run('proxy that loses its traps: method', T52, W52);
function T53(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that loses its traps: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T53, F53); return 1; }
const H53: any = { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }; const F53: any = new Proxy(T53, H53); T53.call(S, 'x', 'y');
const W53 = () => F53`a${1}b`; run('proxy that loses its traps: tagged', T53, W53); delete H53.apply; delete H53.construct; run('proxy that loses its traps: tagged', T53, W53);
function T54(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that loses its traps: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T54, F54); return 1; }
const H54: any = { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }; const F54: any = new Proxy(T54, H54); T54.call(S, 'x', 'y');
const W54 = () => new F54(1); run('proxy that loses its traps: new', T54, W54); delete H54.apply; delete H54.construct; run('proxy that loses its traps: new', T54, W54);
function T55(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy that loses its traps: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T55, F55); return 1; }
const H55: any = { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }; const F55: any = new Proxy(T55, H55); T55.call(S, 'x', 'y');
const W55 = () => [1].map(F55); run('proxy that loses its traps: map', T55, W55); delete H55.apply; delete H55.construct; run('proxy that loses its traps: map', T55, W55);
function T56(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler inherits: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T56, F56); return 1; }
const F56: any = new Proxy(T56, Object.create({ apply(t, r, list) { return Reflect.apply(t, r === undefined ? O : r, list); } })); T56.call(S, 'x', 'y');
const W56 = () => F56(1); run('proxy whose handler inherits: bare', T56, W56);
function T57(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler inherits: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T57, F57); return 1; }
const F57: any = new Proxy(T57, Object.create({ apply(t, r, list) { return Reflect.apply(t, r === undefined ? O : r, list); } })); T57.call(S, 'x', 'y');
const W57 = () => ({ m: F57, n: 3 }).m(1); run('proxy whose handler inherits: method', T57, W57);
function T58(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler inherits: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T58, F58); return 1; }
const F58: any = new Proxy(T58, Object.create({ apply(t, r, list) { return Reflect.apply(t, r === undefined ? O : r, list); } })); T58.call(S, 'x', 'y');
const W58 = () => F58`a${1}b`; run('proxy whose handler inherits: tagged', T58, W58);
function T59(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler inherits: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T59, F59); return 1; }
const F59: any = new Proxy(T59, Object.create({ apply(t, r, list) { return Reflect.apply(t, r === undefined ? O : r, list); } })); T59.call(S, 'x', 'y');
const W59 = () => new F59(1); run('proxy whose handler inherits: new', T59, W59);
function T60(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler inherits: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T60, F60); return 1; }
const F60: any = new Proxy(T60, Object.create({ apply(t, r, list) { return Reflect.apply(t, r === undefined ? O : r, list); } })); T60.call(S, 'x', 'y');
const W60 = () => [1].map(F60); run('proxy whose handler inherits: map', T60, W60);
function T61(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler gets a prototype later: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T61, F61); return 1; }
const H61: any = {}; const F61: any = new Proxy(T61, H61); T61.call(S, 'x', 'y');
const W61 = () => F61(1); run('proxy whose handler gets a prototype later: bare', T61, W61); Object.setPrototypeOf(H61, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); run('proxy whose handler gets a prototype later: bare', T61, W61);
function T62(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler gets a prototype later: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T62, F62); return 1; }
const H62: any = {}; const F62: any = new Proxy(T62, H62); T62.call(S, 'x', 'y');
const W62 = () => ({ m: F62, n: 3 }).m(1); run('proxy whose handler gets a prototype later: method', T62, W62); Object.setPrototypeOf(H62, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); run('proxy whose handler gets a prototype later: method', T62, W62);
function T63(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler gets a prototype later: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T63, F63); return 1; }
const H63: any = {}; const F63: any = new Proxy(T63, H63); T63.call(S, 'x', 'y');
const W63 = () => F63`a${1}b`; run('proxy whose handler gets a prototype later: tagged', T63, W63); Object.setPrototypeOf(H63, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); run('proxy whose handler gets a prototype later: tagged', T63, W63);
function T64(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler gets a prototype later: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T64, F64); return 1; }
const H64: any = {}; const F64: any = new Proxy(T64, H64); T64.call(S, 'x', 'y');
const W64 = () => new F64(1); run('proxy whose handler gets a prototype later: new', T64, W64); Object.setPrototypeOf(H64, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); run('proxy whose handler gets a prototype later: new', T64, W64);
function T65(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler gets a prototype later: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T65, F65); return 1; }
const H65: any = {}; const F65: any = new Proxy(T65, H65); T65.call(S, 'x', 'y');
const W65 = () => [1].map(F65); run('proxy whose handler gets a prototype later: map', T65, W65); Object.setPrototypeOf(H65, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); run('proxy whose handler gets a prototype later: map', T65, W65);
function T66(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T66, F66); return 1; }
const F66: any = new Proxy(T66, new Proxy({}, {})); T66.call(S, 'x', 'y');
const W66 = () => F66(1); run('proxy whose handler is a proxy: bare', T66, W66);
function T67(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T67, F67); return 1; }
const F67: any = new Proxy(T67, new Proxy({}, {})); T67.call(S, 'x', 'y');
const W67 = () => ({ m: F67, n: 3 }).m(1); run('proxy whose handler is a proxy: method', T67, W67);
function T68(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T68, F68); return 1; }
const F68: any = new Proxy(T68, new Proxy({}, {})); T68.call(S, 'x', 'y');
const W68 = () => F68`a${1}b`; run('proxy whose handler is a proxy: tagged', T68, W68);
function T69(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T69, F69); return 1; }
const F69: any = new Proxy(T69, new Proxy({}, {})); T69.call(S, 'x', 'y');
const W69 = () => new F69(1); run('proxy whose handler is a proxy: new', T69, W69);
function T70(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T70, F70); return 1; }
const F70: any = new Proxy(T70, new Proxy({}, {})); T70.call(S, 'x', 'y');
const W70 = () => [1].map(F70); run('proxy whose handler is a proxy: map', T70, W70);
function T71(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy that answers: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T71, F71); return 1; }
const F71: any = new Proxy(T71, new Proxy({}, { get(t, k) { return k === 'apply' ? function (t, r, list) { return Reflect.apply(t, O, list); } : undefined; } })); T71.call(S, 'x', 'y');
const W71 = () => F71(1); run('proxy whose handler is a proxy that answers: bare', T71, W71);
function T72(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy that answers: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T72, F72); return 1; }
const F72: any = new Proxy(T72, new Proxy({}, { get(t, k) { return k === 'apply' ? function (t, r, list) { return Reflect.apply(t, O, list); } : undefined; } })); T72.call(S, 'x', 'y');
const W72 = () => ({ m: F72, n: 3 }).m(1); run('proxy whose handler is a proxy that answers: method', T72, W72);
function T73(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy that answers: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T73, F73); return 1; }
const F73: any = new Proxy(T73, new Proxy({}, { get(t, k) { return k === 'apply' ? function (t, r, list) { return Reflect.apply(t, O, list); } : undefined; } })); T73.call(S, 'x', 'y');
const W73 = () => F73`a${1}b`; run('proxy whose handler is a proxy that answers: tagged', T73, W73);
function T74(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy that answers: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T74, F74); return 1; }
const F74: any = new Proxy(T74, new Proxy({}, { get(t, k) { return k === 'apply' ? function (t, r, list) { return Reflect.apply(t, O, list); } : undefined; } })); T74.call(S, 'x', 'y');
const W74 = () => new F74(1); run('proxy whose handler is a proxy that answers: new', T74, W74);
function T75(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a proxy that answers: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T75, F75); return 1; }
const F75: any = new Proxy(T75, new Proxy({}, { get(t, k) { return k === 'apply' ? function (t, r, list) { return Reflect.apply(t, O, list); } : undefined; } })); T75.call(S, 'x', 'y');
const W75 = () => [1].map(F75); run('proxy whose handler is a proxy that answers: map', T75, W75);
function T76(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap tells: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T76, F76); return 1; }
const H76: any = { n: 12, apply(t, r, list) { console.log('proxy whose trap tells: bare', 'trap', this === H76, r === undefined ? 'undefined' : r === S ? 'self' : r === O ? 'other' : typeof r, list.length); return Reflect.apply(t, r, list); } }; const F76: any = new Proxy(T76, H76); T76.call(S, 'x', 'y');
const W76 = () => F76(1); run('proxy whose trap tells: bare', T76, W76);
function T77(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap tells: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T77, F77); return 1; }
const H77: any = { n: 12, apply(t, r, list) { console.log('proxy whose trap tells: method', 'trap', this === H77, r === undefined ? 'undefined' : r === S ? 'self' : r === O ? 'other' : typeof r, list.length); return Reflect.apply(t, r, list); } }; const F77: any = new Proxy(T77, H77); T77.call(S, 'x', 'y');
const W77 = () => ({ m: F77, n: 3 }).m(1); run('proxy whose trap tells: method', T77, W77);
function T78(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap tells: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T78, F78); return 1; }
const H78: any = { n: 12, apply(t, r, list) { console.log('proxy whose trap tells: tagged', 'trap', this === H78, r === undefined ? 'undefined' : r === S ? 'self' : r === O ? 'other' : typeof r, list.length); return Reflect.apply(t, r, list); } }; const F78: any = new Proxy(T78, H78); T78.call(S, 'x', 'y');
const W78 = () => F78`a${1}b`; run('proxy whose trap tells: tagged', T78, W78);
function T79(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap tells: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T79, F79); return 1; }
const H79: any = { n: 12, apply(t, r, list) { console.log('proxy whose trap tells: new', 'trap', this === H79, r === undefined ? 'undefined' : r === S ? 'self' : r === O ? 'other' : typeof r, list.length); return Reflect.apply(t, r, list); } }; const F79: any = new Proxy(T79, H79); T79.call(S, 'x', 'y');
const W79 = () => new F79(1); run('proxy whose trap tells: new', T79, W79);
function T80(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap tells: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T80, F80); return 1; }
const H80: any = { n: 12, apply(t, r, list) { console.log('proxy whose trap tells: map', 'trap', this === H80, r === undefined ? 'undefined' : r === S ? 'self' : r === O ? 'other' : typeof r, list.length); return Reflect.apply(t, r, list); } }; const F80: any = new Proxy(T80, H80); T80.call(S, 'x', 'y');
const W80 = () => [1].map(F80); run('proxy whose trap tells: map', T80, W80);
function T81(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T81, F81); return 1; }
const F81: any = T81.bind(); T81.call(S, 'x', 'y');
const W81 = () => F81(1); run('bound to nothing: bare', T81, W81);
function T82(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T82, F82); return 1; }
const F82: any = T82.bind(); T82.call(S, 'x', 'y');
const W82 = () => ({ m: F82, n: 3 }).m(1); run('bound to nothing: method', T82, W82);
function T83(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T83, F83); return 1; }
const F83: any = T83.bind(); T83.call(S, 'x', 'y');
const W83 = () => F83`a${1}b`; run('bound to nothing: tagged', T83, W83);
function T84(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T84, F84); return 1; }
const F84: any = T84.bind(); T84.call(S, 'x', 'y');
const W84 = () => new F84(1); run('bound to nothing: new', T84, W84);
function T85(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T85, F85); return 1; }
const F85: any = T85.bind(); T85.call(S, 'x', 'y');
const W85 = () => [1].map(F85); run('bound to nothing: map', T85, W85);
function T86(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to an object: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T86, F86); return 1; }
const F86: any = T86.bind(O); T86.call(S, 'x', 'y');
const W86 = () => F86(1); run('bound to an object: bare', T86, W86);
function T87(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to an object: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T87, F87); return 1; }
const F87: any = T87.bind(O); T87.call(S, 'x', 'y');
const W87 = () => ({ m: F87, n: 3 }).m(1); run('bound to an object: method', T87, W87);
function T88(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to an object: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T88, F88); return 1; }
const F88: any = T88.bind(O); T88.call(S, 'x', 'y');
const W88 = () => F88`a${1}b`; run('bound to an object: tagged', T88, W88);
function T89(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to an object: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T89, F89); return 1; }
const F89: any = T89.bind(O); T89.call(S, 'x', 'y');
const W89 = () => new F89(1); run('bound to an object: new', T89, W89);
function T90(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to an object: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T90, F90); return 1; }
const F90: any = T90.bind(O); T90.call(S, 'x', 'y');
const W90 = () => [1].map(F90); run('bound to an object: map', T90, W90);
function T91(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound with an argument: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T91, F91); return 1; }
const F91: any = T91.bind(O, 1); T91.call(S, 'x', 'y');
const W91 = () => F91(1); run('bound with an argument: bare', T91, W91);
function T92(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound with an argument: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T92, F92); return 1; }
const F92: any = T92.bind(O, 1); T92.call(S, 'x', 'y');
const W92 = () => ({ m: F92, n: 3 }).m(1); run('bound with an argument: method', T92, W92);
function T93(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound with an argument: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T93, F93); return 1; }
const F93: any = T93.bind(O, 1); T93.call(S, 'x', 'y');
const W93 = () => F93`a${1}b`; run('bound with an argument: tagged', T93, W93);
function T94(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound with an argument: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T94, F94); return 1; }
const F94: any = T94.bind(O, 1); T94.call(S, 'x', 'y');
const W94 = () => new F94(1); run('bound with an argument: new', T94, W94);
function T95(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound with an argument: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T95, F95); return 1; }
const F95: any = T95.bind(O, 1); T95.call(S, 'x', 'y');
const W95 = () => [1].map(F95); run('bound with an argument: map', T95, W95);
function T96(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a bound function: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T96, F96); return 1; }
const F96: any = new Proxy(T96.bind(O), {}); T96.call(S, 'x', 'y');
const W96 = () => F96(1); run('proxy of a bound function: bare', T96, W96);
function T97(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a bound function: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T97, F97); return 1; }
const F97: any = new Proxy(T97.bind(O), {}); T97.call(S, 'x', 'y');
const W97 = () => ({ m: F97, n: 3 }).m(1); run('proxy of a bound function: method', T97, W97);
function T98(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a bound function: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T98, F98); return 1; }
const F98: any = new Proxy(T98.bind(O), {}); T98.call(S, 'x', 'y');
const W98 = () => F98`a${1}b`; run('proxy of a bound function: tagged', T98, W98);
function T99(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a bound function: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T99, F99); return 1; }
const F99: any = new Proxy(T99.bind(O), {}); T99.call(S, 'x', 'y');
const W99 = () => new F99(1); run('proxy of a bound function: new', T99, W99);
function T100(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a bound function: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T100, F100); return 1; }
const F100: any = new Proxy(T100.bind(O), {}); T100.call(S, 'x', 'y');
const W100 = () => [1].map(F100); run('proxy of a bound function: map', T100, W100);
function T101(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a function bound to nothing: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T101, F101); return 1; }
const F101: any = new Proxy(T101.bind(), {}); T101.call(S, 'x', 'y');
const W101 = () => F101(1); run('proxy of a function bound to nothing: bare', T101, W101);
function T102(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a function bound to nothing: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T102, F102); return 1; }
const F102: any = new Proxy(T102.bind(), {}); T102.call(S, 'x', 'y');
const W102 = () => ({ m: F102, n: 3 }).m(1); run('proxy of a function bound to nothing: method', T102, W102);
function T103(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a function bound to nothing: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T103, F103); return 1; }
const F103: any = new Proxy(T103.bind(), {}); T103.call(S, 'x', 'y');
const W103 = () => F103`a${1}b`; run('proxy of a function bound to nothing: tagged', T103, W103);
function T104(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a function bound to nothing: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T104, F104); return 1; }
const F104: any = new Proxy(T104.bind(), {}); T104.call(S, 'x', 'y');
const W104 = () => new F104(1); run('proxy of a function bound to nothing: new', T104, W104);
function T105(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy of a function bound to nothing: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T105, F105); return 1; }
const F105: any = new Proxy(T105.bind(), {}); T105.call(S, 'x', 'y');
const W105 = () => [1].map(F105); run('proxy of a function bound to nothing: map', T105, W105);
function T106(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound over a proxy: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T106, F106); return 1; }
const F106: any = new Proxy(T106, {}).bind(O); T106.call(S, 'x', 'y');
const W106 = () => F106(1); run('bound over a proxy: bare', T106, W106);
function T107(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound over a proxy: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T107, F107); return 1; }
const F107: any = new Proxy(T107, {}).bind(O); T107.call(S, 'x', 'y');
const W107 = () => ({ m: F107, n: 3 }).m(1); run('bound over a proxy: method', T107, W107);
function T108(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound over a proxy: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T108, F108); return 1; }
const F108: any = new Proxy(T108, {}).bind(O); T108.call(S, 'x', 'y');
const W108 = () => F108`a${1}b`; run('bound over a proxy: tagged', T108, W108);
function T109(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound over a proxy: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T109, F109); return 1; }
const F109: any = new Proxy(T109, {}).bind(O); T109.call(S, 'x', 'y');
const W109 = () => new F109(1); run('bound over a proxy: new', T109, W109);
function T110(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound over a proxy: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T110, F110); return 1; }
const F110: any = new Proxy(T110, {}).bind(O); T110.call(S, 'x', 'y');
const W110 = () => [1].map(F110); run('bound over a proxy: map', T110, W110);
function T111(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing over a proxy: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T111, F111); return 1; }
const F111: any = new Proxy(T111, {}).bind(); T111.call(S, 'x', 'y');
const W111 = () => F111(1); run('bound to nothing over a proxy: bare', T111, W111);
function T112(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing over a proxy: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T112, F112); return 1; }
const F112: any = new Proxy(T112, {}).bind(); T112.call(S, 'x', 'y');
const W112 = () => ({ m: F112, n: 3 }).m(1); run('bound to nothing over a proxy: method', T112, W112);
function T113(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing over a proxy: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T113, F113); return 1; }
const F113: any = new Proxy(T113, {}).bind(); T113.call(S, 'x', 'y');
const W113 = () => F113`a${1}b`; run('bound to nothing over a proxy: tagged', T113, W113);
function T114(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing over a proxy: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T114, F114); return 1; }
const F114: any = new Proxy(T114, {}).bind(); T114.call(S, 'x', 'y');
const W114 = () => new F114(1); run('bound to nothing over a proxy: new', T114, W114);
function T115(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('bound to nothing over a proxy: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T115, F115); return 1; }
const F115: any = new Proxy(T115, {}).bind(); T115.call(S, 'x', 'y');
const W115 = () => [1].map(F115); run('bound to nothing over a proxy: map', T115, W115);
function T116(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy kept in a field: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T116, F116); return 1; }
const K116: any = { kept: new Proxy(T116, {}) }; const F116: any = K116.kept; T116.call(S, 'x', 'y');
const W116 = () => F116(1); run('proxy kept in a field: bare', T116, W116);
function T117(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy kept in a field: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T117, F117); return 1; }
const K117: any = { kept: new Proxy(T117, {}) }; const F117: any = K117.kept; T117.call(S, 'x', 'y');
const W117 = () => ({ m: F117, n: 3 }).m(1); run('proxy kept in a field: method', T117, W117);
function T118(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy kept in a field: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T118, F118); return 1; }
const K118: any = { kept: new Proxy(T118, {}) }; const F118: any = K118.kept; T118.call(S, 'x', 'y');
const W118 = () => F118`a${1}b`; run('proxy kept in a field: tagged', T118, W118);
function T119(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy kept in a field: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T119, F119); return 1; }
const K119: any = { kept: new Proxy(T119, {}) }; const F119: any = K119.kept; T119.call(S, 'x', 'y');
const W119 = () => new F119(1); run('proxy kept in a field: new', T119, W119);
function T120(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy kept in a field: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T120, F120); return 1; }
const K120: any = { kept: new Proxy(T120, {}) }; const F120: any = K120.kept; T120.call(S, 'x', 'y');
const W120 = () => [1].map(F120); run('proxy kept in a field: map', T120, W120);
function T121(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy or the function: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T121, F121); return 1; }
let F121: any = T121; T121.call(S, 'x', 'y');
const W121 = () => F121(1); run('proxy or the function: bare', T121, W121); F121 = new Proxy(T121, {}); run('proxy or the function: bare', T121, W121);
function T122(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy or the function: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T122, F122); return 1; }
let F122: any = T122; T122.call(S, 'x', 'y');
const W122 = () => ({ m: F122, n: 3 }).m(1); run('proxy or the function: method', T122, W122); F122 = new Proxy(T122, {}); run('proxy or the function: method', T122, W122);
function T123(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy or the function: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T123, F123); return 1; }
let F123: any = T123; T123.call(S, 'x', 'y');
const W123 = () => F123`a${1}b`; run('proxy or the function: tagged', T123, W123); F123 = new Proxy(T123, {}); run('proxy or the function: tagged', T123, W123);
function T124(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy or the function: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T124, F124); return 1; }
let F124: any = T124; T124.call(S, 'x', 'y');
const W124 = () => new F124(1); run('proxy or the function: new', T124, W124); F124 = new Proxy(T124, {}); run('proxy or the function: new', T124, W124);
function T125(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy or the function: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T125, F125); return 1; }
let F125: any = T125; T125.call(S, 'x', 'y');
const W125 = () => [1].map(F125); run('proxy or the function: map', T125, W125); F125 = new Proxy(T125, {}); run('proxy or the function: map', T125, W125);
function T126(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by a function: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T126, F126); return 1; }
function M126(f) { return new Proxy(f, {}); } const F126: any = M126(T126); T126.call(S, 'x', 'y');
const W126 = () => F126(1); run('proxy made by a function: bare', T126, W126);
function T127(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by a function: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T127, F127); return 1; }
function M127(f) { return new Proxy(f, {}); } const F127: any = M127(T127); T127.call(S, 'x', 'y');
const W127 = () => ({ m: F127, n: 3 }).m(1); run('proxy made by a function: method', T127, W127);
function T128(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by a function: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T128, F128); return 1; }
function M128(f) { return new Proxy(f, {}); } const F128: any = M128(T128); T128.call(S, 'x', 'y');
const W128 = () => F128`a${1}b`; run('proxy made by a function: tagged', T128, W128);
function T129(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by a function: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T129, F129); return 1; }
function M129(f) { return new Proxy(f, {}); } const F129: any = M129(T129); T129.call(S, 'x', 'y');
const W129 = () => new F129(1); run('proxy made by a function: new', T129, W129);
function T130(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by a function: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T130, F130); return 1; }
function M130(f) { return new Proxy(f, {}); } const F130: any = M130(T130); T130.call(S, 'x', 'y');
const W130 = () => [1].map(F130); run('proxy made by a function: map', T130, W130);
function T131(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by reflect: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T131, F131); return 1; }
const F131: any = Reflect.construct(Proxy, [T131, {}]); T131.call(S, 'x', 'y');
const W131 = () => F131(1); run('proxy made by reflect: bare', T131, W131);
function T132(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by reflect: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T132, F132); return 1; }
const F132: any = Reflect.construct(Proxy, [T132, {}]); T132.call(S, 'x', 'y');
const W132 = () => ({ m: F132, n: 3 }).m(1); run('proxy made by reflect: method', T132, W132);
function T133(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by reflect: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T133, F133); return 1; }
const F133: any = Reflect.construct(Proxy, [T133, {}]); T133.call(S, 'x', 'y');
const W133 = () => F133`a${1}b`; run('proxy made by reflect: tagged', T133, W133);
function T134(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by reflect: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T134, F134); return 1; }
const F134: any = Reflect.construct(Proxy, [T134, {}]); T134.call(S, 'x', 'y');
const W134 = () => new F134(1); run('proxy made by reflect: new', T134, W134);
function T135(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy made by reflect: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T135, F135); return 1; }
const F135: any = Reflect.construct(Proxy, [T135, {}]); T135.call(S, 'x', 'y');
const W135 = () => [1].map(F135); run('proxy made by reflect: map', T135, W135);
function T136(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a variable: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T136, F136); return 1; }
const H136: any = {}; const F136: any = new Proxy(T136, H136); T136.call(S, 'x', 'y');
const W136 = () => F136(1); run('proxy whose handler is a variable: bare', T136, W136);
function T137(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a variable: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T137, F137); return 1; }
const H137: any = {}; const F137: any = new Proxy(T137, H137); T137.call(S, 'x', 'y');
const W137 = () => ({ m: F137, n: 3 }).m(1); run('proxy whose handler is a variable: method', T137, W137);
function T138(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a variable: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T138, F138); return 1; }
const H138: any = {}; const F138: any = new Proxy(T138, H138); T138.call(S, 'x', 'y');
const W138 = () => F138`a${1}b`; run('proxy whose handler is a variable: tagged', T138, W138);
function T139(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a variable: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T139, F139); return 1; }
const H139: any = {}; const F139: any = new Proxy(T139, H139); T139.call(S, 'x', 'y');
const W139 = () => new F139(1); run('proxy whose handler is a variable: new', T139, W139);
function T140(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose handler is a variable: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T140, F140); return 1; }
const H140: any = {}; const F140: any = new Proxy(T140, H140); T140.call(S, 'x', 'y');
const W140 = () => [1].map(F140); run('proxy whose handler is a variable: map', T140, W140);
function T141(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is undefined: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T141, F141); return 1; }
const F141: any = new Proxy(T141, { apply: undefined, construct: undefined }); T141.call(S, 'x', 'y');
const W141 = () => F141(1); run('proxy whose trap is undefined: bare', T141, W141);
function T142(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is undefined: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T142, F142); return 1; }
const F142: any = new Proxy(T142, { apply: undefined, construct: undefined }); T142.call(S, 'x', 'y');
const W142 = () => ({ m: F142, n: 3 }).m(1); run('proxy whose trap is undefined: method', T142, W142);
function T143(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is undefined: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T143, F143); return 1; }
const F143: any = new Proxy(T143, { apply: undefined, construct: undefined }); T143.call(S, 'x', 'y');
const W143 = () => F143`a${1}b`; run('proxy whose trap is undefined: tagged', T143, W143);
function T144(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is undefined: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T144, F144); return 1; }
const F144: any = new Proxy(T144, { apply: undefined, construct: undefined }); T144.call(S, 'x', 'y');
const W144 = () => new F144(1); run('proxy whose trap is undefined: new', T144, W144);
function T145(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is undefined: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T145, F145); return 1; }
const F145: any = new Proxy(T145, { apply: undefined, construct: undefined }); T145.call(S, 'x', 'y');
const W145 = () => [1].map(F145); run('proxy whose trap is undefined: map', T145, W145);
function T146(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is null: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T146, F146); return 1; }
const F146: any = new Proxy(T146, { apply: null, construct: null }); T146.call(S, 'x', 'y');
const W146 = () => F146(1); run('proxy whose trap is null: bare', T146, W146);
function T147(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is null: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T147, F147); return 1; }
const F147: any = new Proxy(T147, { apply: null, construct: null }); T147.call(S, 'x', 'y');
const W147 = () => ({ m: F147, n: 3 }).m(1); run('proxy whose trap is null: method', T147, W147);
function T148(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is null: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T148, F148); return 1; }
const F148: any = new Proxy(T148, { apply: null, construct: null }); T148.call(S, 'x', 'y');
const W148 = () => F148`a${1}b`; run('proxy whose trap is null: tagged', T148, W148);
function T149(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is null: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T149, F149); return 1; }
const F149: any = new Proxy(T149, { apply: null, construct: null }); T149.call(S, 'x', 'y');
const W149 = () => new F149(1); run('proxy whose trap is null: new', T149, W149);
function T150(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is null: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T150, F150); return 1; }
const F150: any = new Proxy(T150, { apply: null, construct: null }); T150.call(S, 'x', 'y');
const W150 = () => [1].map(F150); run('proxy whose trap is null: map', T150, W150);
function T151(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T151, F151); return 1; }
const F151: any = new Proxy(T151, { get apply() { return function (t, r, list) { return Reflect.apply(t, O, list); }; } }); T151.call(S, 'x', 'y');
const W151 = () => F151(1); run('proxy whose trap is a getter: bare', T151, W151);
function T152(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T152, F152); return 1; }
const F152: any = new Proxy(T152, { get apply() { return function (t, r, list) { return Reflect.apply(t, O, list); }; } }); T152.call(S, 'x', 'y');
const W152 = () => ({ m: F152, n: 3 }).m(1); run('proxy whose trap is a getter: method', T152, W152);
function T153(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T153, F153); return 1; }
const F153: any = new Proxy(T153, { get apply() { return function (t, r, list) { return Reflect.apply(t, O, list); }; } }); T153.call(S, 'x', 'y');
const W153 = () => F153`a${1}b`; run('proxy whose trap is a getter: tagged', T153, W153);
function T154(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T154, F154); return 1; }
const F154: any = new Proxy(T154, { get apply() { return function (t, r, list) { return Reflect.apply(t, O, list); }; } }); T154.call(S, 'x', 'y');
const W154 = () => new F154(1); run('proxy whose trap is a getter: new', T154, W154);
function T155(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T155, F155); return 1; }
const F155: any = new Proxy(T155, { get apply() { return function (t, r, list) { return Reflect.apply(t, O, list); }; } }); T155.call(S, 'x', 'y');
const W155 = () => [1].map(F155); run('proxy whose trap is a getter: map', T155, W155);
function T156(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter of nothing: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T156, F156); return 1; }
const F156: any = new Proxy(T156, { get apply() { return undefined; } }); T156.call(S, 'x', 'y');
const W156 = () => F156(1); run('proxy whose trap is a getter of nothing: bare', T156, W156);
function T157(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter of nothing: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T157, F157); return 1; }
const F157: any = new Proxy(T157, { get apply() { return undefined; } }); T157.call(S, 'x', 'y');
const W157 = () => ({ m: F157, n: 3 }).m(1); run('proxy whose trap is a getter of nothing: method', T157, W157);
function T158(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter of nothing: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T158, F158); return 1; }
const F158: any = new Proxy(T158, { get apply() { return undefined; } }); T158.call(S, 'x', 'y');
const W158 = () => F158`a${1}b`; run('proxy whose trap is a getter of nothing: tagged', T158, W158);
function T159(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter of nothing: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T159, F159); return 1; }
const F159: any = new Proxy(T159, { get apply() { return undefined; } }); T159.call(S, 'x', 'y');
const W159 = () => new F159(1); run('proxy whose trap is a getter of nothing: new', T159, W159);
function T160(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy whose trap is a getter of nothing: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T160, F160); return 1; }
const F160: any = new Proxy(T160, { get apply() { return undefined; } }); T160.call(S, 'x', 'y');
const W160 = () => [1].map(F160); run('proxy whose trap is a getter of nothing: map', T160, W160);
function T161(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps over one with: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T161, F161); return 1; }
const F161: any = new Proxy(new Proxy(T161, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }), {}); T161.call(S, 'x', 'y');
const W161 = () => F161(1); run('proxy without traps over one with: bare', T161, W161);
function T162(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps over one with: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T162, F162); return 1; }
const F162: any = new Proxy(new Proxy(T162, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }), {}); T162.call(S, 'x', 'y');
const W162 = () => ({ m: F162, n: 3 }).m(1); run('proxy without traps over one with: method', T162, W162);
function T163(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps over one with: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T163, F163); return 1; }
const F163: any = new Proxy(new Proxy(T163, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }), {}); T163.call(S, 'x', 'y');
const W163 = () => F163`a${1}b`; run('proxy without traps over one with: tagged', T163, W163);
function T164(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps over one with: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T164, F164); return 1; }
const F164: any = new Proxy(new Proxy(T164, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }), {}); T164.call(S, 'x', 'y');
const W164 = () => new F164(1); run('proxy without traps over one with: new', T164, W164);
function T165(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy without traps over one with: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T165, F165); return 1; }
const F165: any = new Proxy(new Proxy(T165, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }), {}); T165.call(S, 'x', 'y');
const W165 = () => [1].map(F165); run('proxy without traps over one with: map', T165, W165);
function T166(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with traps over one without: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T166, F166); return 1; }
const F166: any = new Proxy(new Proxy(T166, {}), { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T166.call(S, 'x', 'y');
const W166 = () => F166(1); run('proxy with traps over one without: bare', T166, W166);
function T167(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with traps over one without: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T167, F167); return 1; }
const F167: any = new Proxy(new Proxy(T167, {}), { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T167.call(S, 'x', 'y');
const W167 = () => ({ m: F167, n: 3 }).m(1); run('proxy with traps over one without: method', T167, W167);
function T168(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with traps over one without: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T168, F168); return 1; }
const F168: any = new Proxy(new Proxy(T168, {}), { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T168.call(S, 'x', 'y');
const W168 = () => F168`a${1}b`; run('proxy with traps over one without: tagged', T168, W168);
function T169(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with traps over one without: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T169, F169); return 1; }
const F169: any = new Proxy(new Proxy(T169, {}), { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T169.call(S, 'x', 'y');
const W169 = () => new F169(1); run('proxy with traps over one without: new', T169, W169);
function T170(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('proxy with traps over one without: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T170, F170); return 1; }
const F170: any = new Proxy(new Proxy(T170, {}), { apply(t, r, list) { return Reflect.apply(t, r, list); }, construct(t, list, n) { return Reflect.construct(t, list, n); } }); T170.call(S, 'x', 'y');
const W170 = () => [1].map(F170); run('proxy with traps over one without: map', T170, W170);
function T171(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one without traps: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T171, F171); return 1; }
const F171: any = Math.random() < 2 ? new Proxy(T171, {}) : new Proxy(T171, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T171.call(S, 'x', 'y');
const W171 = () => F171(1); run('one of two proxies the one without traps: bare', T171, W171);
function T172(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one without traps: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T172, F172); return 1; }
const F172: any = Math.random() < 2 ? new Proxy(T172, {}) : new Proxy(T172, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T172.call(S, 'x', 'y');
const W172 = () => ({ m: F172, n: 3 }).m(1); run('one of two proxies the one without traps: method', T172, W172);
function T173(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one without traps: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T173, F173); return 1; }
const F173: any = Math.random() < 2 ? new Proxy(T173, {}) : new Proxy(T173, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T173.call(S, 'x', 'y');
const W173 = () => F173`a${1}b`; run('one of two proxies the one without traps: tagged', T173, W173);
function T174(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one without traps: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T174, F174); return 1; }
const F174: any = Math.random() < 2 ? new Proxy(T174, {}) : new Proxy(T174, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T174.call(S, 'x', 'y');
const W174 = () => new F174(1); run('one of two proxies the one without traps: new', T174, W174);
function T175(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one without traps: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T175, F175); return 1; }
const F175: any = Math.random() < 2 ? new Proxy(T175, {}) : new Proxy(T175, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }); T175.call(S, 'x', 'y');
const W175 = () => [1].map(F175); run('one of two proxies the one without traps: map', T175, W175);
function T176(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one with traps: bare', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T176, F176); return 1; }
const F176: any = Math.random() < 2 ? new Proxy(T176, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }) : new Proxy(T176, {}); T176.call(S, 'x', 'y');
const W176 = () => F176(1); run('one of two proxies the one with traps: bare', T176, W176);
function T177(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one with traps: method', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T177, F177); return 1; }
const F177: any = Math.random() < 2 ? new Proxy(T177, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }) : new Proxy(T177, {}); T177.call(S, 'x', 'y');
const W177 = () => ({ m: F177, n: 3 }).m(1); run('one of two proxies the one with traps: method', T177, W177);
function T178(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one with traps: tagged', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T178, F178); return 1; }
const F178: any = Math.random() < 2 ? new Proxy(T178, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }) : new Proxy(T178, {}); T178.call(S, 'x', 'y');
const W178 = () => F178`a${1}b`; run('one of two proxies the one with traps: tagged', T178, W178);
function T179(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one with traps: new', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T179, F179); return 1; }
const F179: any = Math.random() < 2 ? new Proxy(T179, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }) : new Proxy(T179, {}); T179.call(S, 'x', 'y');
const W179 = () => new F179(1); run('one of two proxies the one with traps: new', T179, W179);
function T180(this: any, a?: any, b?: any): any { let n; try { n = this.n; } catch { n = 'throws'; } say('one of two proxies the one with traps: map', this === undefined ? 'undefined' : this === S ? 'self' : this === O ? 'other' : this === globalThis ? 'global' : typeof this, n, typeof a, typeof b, arguments.length, new.target, T180, F180); return 1; }
const F180: any = Math.random() < 2 ? new Proxy(T180, { apply(t, r, list) { return Reflect.apply(t, O, list); }, construct(t, list) { return Reflect.construct(t, list, N); } }) : new Proxy(T180, {}); T180.call(S, 'x', 'y');
const W180 = () => [1].map(F180); run('one of two proxies the one with traps: map', T180, W180);
