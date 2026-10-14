"use strict";
const kept = [];
function leak(a) { kept.push(a); a.push("leaked"); return a.length; }
function shrink(a) { a.length = 0; return 0; }
// The callee is small enough to be copied, or becomes so where the number of arguments is known.
function dispatch(f, ...args) {
  switch (args.length) {
    case 0: return f();
    case 1: return f(args[0]);
    case 2: return f(args[0], args[1]);
    default: return f.apply(undefined, args);
  }
}
function each(list, ...args) {
  let s = "";
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    switch (args.length) {
      case 0: s += f(); break;
      case 1: s += f(args[0]); break;
      case 2: s += f(args[0], args[1]); break;
      default: s += f.apply(undefined, args);
    }
  }
  return s;
}
function leaksWhenLong(...args) { let s = 0; for (let i = 0; i < 3; i++) { if (args.length > 2) s += leak(args); else s += args.length; } return s + ":" + args.length; }
function leaksWhenShort(...args) { let s = 0; for (let i = 0; i < 3; i++) { if (args.length < 2) s += leak(args); else s += args.length; } return s + ":" + args.length; }
function shrinksWhenTwo(...args) { let s = ""; for (let i = 0; i < 3; i++) { s += args.length; if (args.length === 2) shrink(args); } return s; }
function join() { return Array.prototype.join.call(arguments, "+") + "/" + arguments.length; }
function callers() {
  return [dispatch(join), dispatch(join, 1), dispatch(join, 1, 2), dispatch(join, 1, 2, 3), dispatch(join, 1, 2, 3, 4, 5), each([join, join]), each([join, join], 1), each([join, join], 1, 2), each([join, join], 1, 2, 3), each([], 1, 2, 3),
    leaksWhenLong(), leaksWhenLong(1), leaksWhenLong(1, 2), leaksWhenLong(1, 2, 3), leaksWhenShort(), leaksWhenShort(1), leaksWhenShort(1, 2), shrinksWhenTwo(1), shrinksWhenTwo(1, 2), shrinksWhenTwo(1, 2, 3)].join(" | ");
}
function literals(x, y) {
  const out = [];
  { const a = [x]; if (a.length === 2) leak(a); out.push(a[0], a.length); }
  { const a = [x, y]; if (a.length === 2) leak(a); out.push(a[0], a.length); }
  { const a = [x]; a.push(y); if (a.length === 1) out.push("one"); else out.push("not one", a.length); }
  { const a = [x, y]; if (a.length !== 2) a.length = 0; out.push(a.length, a[1]); }
  { const a = [x, y]; if (a.length == 2) a.length = 1; out.push(a.length, String(a[1])); }
  { const a = []; if (!a.length) out.push("empty"); else leak(a); if (a.length) leak(a); out.push(a.length); }
  { const a = [x, y, x]; for (let i = 0; i < 2; i++) { if (a.length >= 4) leak(a); if (a.length <= 2) shrink(a); out.push(a[i]); } out.push(a.length); }
  { const a = [x], b = [x, y]; if (a.length === b.length) leak(a); if (b.length === 1) leak(b); out.push(a.length + b.length); }
  { const a = [x], n = y; if (a.length === n) leak(a); out.push(a.length); }
  { const a = [x]; let s = 0; for (let i = 0; i < 3; i++) { if (a.length === 1) s += a[0]; else { leak(a); s = -1; } } out.push(s); }
  { const a = [x]; let s = 0; for (let i = 0; i < 3; i++) { if (a.length === 1 && i === 1) leak(a); s += a.length; } out.push(s); }
  { const a = [x, y]; try { if (a.length === 3) leak(a); if (a.length === 2) throw a.length; } catch (e) { out.push("caught", e, a.length); } }
  return out.join();
}
module.exports = { callers, literals, kept };
