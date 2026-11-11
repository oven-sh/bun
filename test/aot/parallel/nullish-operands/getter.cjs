"use strict";
const side = { n: 0 }; class K { constructor(a) { this.a = a; this.b = 2; } }
function make() { return [{ a: 1, get b() { side.n++; return side.n; } }, undefined, { get a() { side.n += 10; return 1; }, b: 2 }, null]; }
function show(v) { try { return typeof v === "object" ? JSON.stringify(v) : String(v); } catch (e) { return e.constructor.name; } }
function f0(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.keys(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(0, f0(make()));
function g0(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.keys(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(0, g0(make()));
function f1(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.values(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(1, f1(make()));
function g1(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.values(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(1, g1(make()));
function f2(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.entries(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(2, f2(make()));
function g2(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.entries(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(2, g2(make()));
function f3(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.getOwnPropertyNames(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(3, f3(make()));
function g3(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.getOwnPropertyNames(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(3, g3(make()));
function f4(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.getOwnPropertySymbols(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(4, f4(make()));
function g4(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.getOwnPropertySymbols(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(4, g4(make()));
function f5(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.hasOwn(x, "a")); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(5, f5(make()));
function g5(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.hasOwn(x, "a"); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(5, g5(make()));
function f6(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.getPrototypeOf(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(6, f6(make()));
function g6(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.getPrototypeOf(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(6, g6(make()));
function f7(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.isFrozen(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(7, f7(make()));
function g7(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.isFrozen(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(7, g7(make()));
function f8(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.freeze(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(8, f8(make()));
function g8(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.freeze(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(8, g8(make()));
function f9(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.assign({}, x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(9, f9(make()));
function g9(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.assign({}, x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(9, g9(make()));
function f10(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.assign(x, { b: 9 })); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(10, f10(make()));
function g10(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.assign(x, { b: 9 }); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(10, g10(make()));
function f11(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.getOwnPropertyDescriptor(x, "a")); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(11, f11(make()));
function g11(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.getOwnPropertyDescriptor(x, "a"); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(11, g11(make()));
function f12(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.fromEntries(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(12, f12(make()));
function g12(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.fromEntries(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(12, g12(make()));
function f13(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Reflect.ownKeys(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(13, f13(make()));
function g13(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Reflect.ownKeys(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(13, g13(make()));
function f14(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Reflect.has(x, "a")); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(14, f14(make()));
function g14(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Reflect.has(x, "a"); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(14, g14(make()));
function f15(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Reflect.get(x, "a")); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(15, f15(make()));
function g15(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Reflect.get(x, "a"); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(15, g15(make()));
function f16(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Array.isArray(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(16, f16(make()));
function g16(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Array.isArray(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(16, g16(make()));
function f17(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Array.from(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(17, f17(make()));
function g17(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Array.from(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(17, g17(make()));
function f18(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(JSON.stringify(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(18, f18(make()));
function g18(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = JSON.stringify(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(18, g18(make()));
function f19(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(String(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(19, f19(make()));
function g19(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = String(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(19, g19(make()));
function f20(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Number(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(20, f20(make()));
function g20(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Number(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(20, g20(make()));
function f21(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Boolean(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(21, f21(make()));
function g21(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Boolean(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(21, g21(make()));
function f22(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Math.max(x, 1)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(22, f22(make()));
function g22(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Math.max(x, 1); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(22, g22(make()));
function f23(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(parseInt(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(23, f23(make()));
function g23(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = parseInt(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(23, g23(make()));
function f24(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(isNaN(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(24, f24(make()));
function g24(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = isNaN(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(24, g24(make()));
function f25(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(new Set(x).size); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(25, f25(make()));
function g25(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = new Set(x).size; r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(25, g25(make()));
function f26(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(new Map(x).size); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(26, f26(make()));
function g26(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = new Map(x).size; r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(26, g26(make()));
function f27(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(structuredClone(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(27, f27(make()));
function g27(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = structuredClone(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(27, g27(make()));
function f28(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.is(x, undefined)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(28, f28(make()));
function g28(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.is(x, undefined); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(28, g28(make()));
function f29(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Symbol(x).toString()); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(29, f29(make()));
function g29(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Symbol(x).toString(); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(29, g29(make()));
function f30(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(encodeURIComponent(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(30, f30(make()));
function g30(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = encodeURIComponent(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(30, g30(make()));
function f31(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.setPrototypeOf(x, null)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(31, f31(make()));
function g31(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.setPrototypeOf(x, null); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(31, g31(make()));
function f32(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.defineProperty(x, "c", { value: 1 })); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(32, f32(make()));
function g32(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.defineProperty(x, "c", { value: 1 }); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(32, g32(make()));
function f33(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.create(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(33, f33(make()));
function g33(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.create(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(33, g33(make()));
function f34(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object(x) === x); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(34, f34(make()));
function g34(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object(x) === x; r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(34, g34(make()));
function f35(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.preventExtensions(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(35, f35(make()));
function g35(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.preventExtensions(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(35, g35(make()));
function f36(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Object.isExtensible(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(36, f36(make()));
function g36(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Object.isExtensible(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(36, g36(make()));
function f37(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(new Array(x).length); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(37, f37(make()));
function g37(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = new Array(x).length; r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(37, g37(make()));
function f38(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show([].concat(x).length); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(38, f38(make()));
function g38(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = [].concat(x).length; r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(38, g38(make()));
function f39(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show("t".includes(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(39, f39(make()));
function g39(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = "t".includes(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(39, g39(make()));
function f40(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Reflect.getPrototypeOf(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(40, f40(make()));
function g40(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Reflect.getPrototypeOf(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(40, g40(make()));
function f41(list) { const r = []; for (let i = 0; i < list.length; i++) { const x = list[i], y = list[(i + 2) % list.length]; const before = side.n, yb = y == null ? 0 : y.b; let v; try { v = show(Number.isInteger(x)); } catch (e) { v = e.constructor.name + ": " + e.message; } r.push(v, side.n - before, (y == null ? 0 : y.b) === yb, show(x)); } return r.join(" "); }
console.log(41, f41(make()));
function g41(list) { const r = []; for (const x of list) { try { const o = { k: side.n }; const v = Number.isInteger(x); r.push(show(v), o.k === side.n, x?.a, x?.b); } catch (e) { r.push(e.message); } } return r.join(" "); }
console.log(41, g41(make()));
