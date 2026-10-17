"use strict";
function h0() { return 1; } function h1(a) { return a + 1; } function h2(a, b) { return a + b; } function h3(a, b, c) { return a + b + c; }
function fail(self, list) { throw new Error("never " + list.length); }
function dispatch(type, ...args) {
  if (type === "error") { let s = 0; for (let i = 0; i < args.length; i++) { s += args[i] * 2; s -= 1; s ^= 3; s |= 1; } return fail(this, args) + s; }
  if (type === "other") { let t = args.length * 3; t = t % 7; t = t ^ 5; t = t | 1; t = t & 255; t = t << 1; t = t >> 1; t = -t; t = ~t; t = t * 3; t = t % 11; t = t ^ 9; t = t | 2; t = t & 127; t = t << 2; t = t >> 2; t = -t; t = ~t; t = t + 1; t = t - 2; t = t * 5; return t; }
  switch (args.length) {
    case 0: { let r = h0(); r = r * 3 + 1; r = r % 7; r = r ^ 5; return r; }
    case 1: { let r = h1(args[0]); r = r * 3 + 1; r = r % 7; r = r ^ 5; return r; }
    case 2: { let r = h2(args[0], args[1]); r = r * 3 + 1; r = r % 7; r = r ^ 5; return r; }
    case 3: { let r = h3(args[0], args[1], args[2]); r = r * 3 + 1; r = r % 7; r = r ^ 5; return r; }
    default: { let r = h0.apply(this, args); r = r * 3 + 1; r = r % 7; r = r ^ 5; return r; }
  }
}
// The switch is inside a loop: `args` reaches it through the parameters of the loop's header, which passes it on unchanged.
function each(list, ...args) {
  let s = 0;
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    switch (args.length) {
      case 0: { let r = f(); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 1: { let r = f(args[0]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 2: { let r = f(args[0], args[1]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 3: { let r = f(args[0], args[1], args[2]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      default: { let r = f.apply(undefined, args); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; }
    }
  }
  return s;
}
// The same, and the array is only ever read or borrowed, as in `emit` of node:events ($apply): no branch hands it to code that is not known.
function eachBorrowing(list, ...args) {
  let s = 0;
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    switch (args.length) {
      case 0: { let r = f(); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 1: { let r = f(args[0]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 2: { let r = f(args[0], args[1]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      case 3: { let r = f(args[0], args[1], args[2]); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; break; }
      default: { let r = Reflect.apply(f, undefined, args); r = r * 3 + 1; r = r % 7; r = r ^ 5; r = r | 1; r = r & 63; s += r; }
    }
  }
  return s;
}
function knowsInTheLoopBorrowing(list, n) { let s = 0; for (let i = 0; i < n; i++) s += eachBorrowing(list, i); return s; }
function knowsInTheLoop(list, n) { let s = 0; for (let i = 0; i < n; i++) s += each(list, i); return s; }
// A little over the limit, and the constant removes only a little: it is still the same function, only larger. It stays a call. It has two calls: the body of a function with one call would move there.
function aLittleTooLarge(flag, a) {
  let t = a * 3; if (flag) { t = t + 1; t = t ^ 2; t = t | 4; }
  t = t % 11; t = t ^ 9; t = t | 2; t = t & 127; t = t << 2; t = t >> 2; t = -t; t = ~t; t = t + 1; t = t - 2; t = t * 5; t = t % 13; t = t ^ 3; t = t | 8; t = t & 255; t = t << 1; t = t >> 1; t = -t; t = ~t; t = t + 3;
  t = t - 4; t = t * 7; t = t % 17; t = t ^ 6; t = t | 16; t = t & 511; t = t << 3; t = t >> 3; t = -t; t = ~t; t = t + 5; t = t - 6; t = t * 9; t = t % 19; t = t ^ 12; t = t | 32; t = t & 1023; t = t + 7;
  return t;
}
function knowsLittle(n) { let s = 0; for (let i = 0; i < n; i++) s += aLittleTooLarge(false, i); return s; }
function knowsLittleToo(n) { let s = 0; for (let i = 0; i < n; i++) s += aLittleTooLarge(true, i); return s; }
function knowsBoth(n) { let s = 0; for (let i = 0; i < n; i++) s += dispatch("x", i); return s; }
function knowsNeither(type, list, n) { let s = 0; for (let i = 0; i < n; i++) s += dispatch(type, ...list); return s; }
function knowsTheNumberOnly(type, n) { let s = 0; for (let i = 0; i < n; i++) s += dispatch(type, i, 1); return s; }
module.exports = { knowsBoth, knowsNeither, knowsTheNumberOnly, knowsInTheLoop, knowsInTheLoopBorrowing, knowsLittle, knowsLittleToo, h1 };
