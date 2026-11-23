// lengths of values of every kind, read in loops that change them or leave them as they are
let calls = 0, M = [1]; const all = process.argv.includes("all"); const DBL = Math.sqrt(9) + calls; const other = [7, 8, 9, 10, 11];
const LIT = () => [1, 2, 3, 4]; function ARGS() { return arguments; } function ARGSS() { "use strict"; return arguments; } class P { constructor(n) { this.length = n; } }
let buffer; const RES = () => { buffer = new ArrayBuffer(8, { maxByteLength: 16 }); return new Uint8Array(buffer, 0, 4); }; const TRACK = () => { buffer = new ArrayBuffer(8, { maxByteLength: 16 }); return new Uint8Array(buffer); }; const shrink = () => { calls++; if (buffer) buffer.resize(buffer.byteLength === 8 ? 2 : 8); };
const HIST = [1, 2, 3]; const change = x => { calls++; if (Array.isArray(x)) x.push(1, 2); }; const size = x => x.length; const add = (x, i) => { x.push(i); }; const touch = () => { calls++; };
function sum(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s = (s + h.length) | 0; return s; }
function sumAny(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += h.length; return s; }
function bound(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < h.length; i++) { s++; if (s > 40) break; } return s; }
function whileBound(h, x, o, p, q, rows, vals, out, k) { let i = 0, s = 0; while (i < h.length * 2) { s += h.length; i++; if (i > 40) break; } return s; }
function down(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = h.length; i > 0; i--) { s += h.length; if (s > 400) break; } return s; }
function some(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) if (i & 1) s += h.length; return s; }
function late(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) if (i > 6) s += h.length; return s; }
function never(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s++; if (i > 60) s += h.length; } return s; }
function equal(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) if (h.length === i) s += 10; else s++; return s; }
function less(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) if (i < h.length) s += 10; else s++; return s; }
function two(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += h.length - x.length; return s; }
function push(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; if (i === 3) x.push(i); } return s; }
function pushAll(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { x.push(i); s += h.length; } return s; }
function append(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { x[x.length] = i; s += h.length; } return s; }
function appendSome(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; if (i & 1) x[x.length] = i; } return s; }
function storeFar(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { x[i] = i; s += h.length; } return s; }
function storeIn(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 2; i++) { x[i] = i; s += h.length; } return s; }
function pop(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 5; i++) { s += h.length; x.pop(); } return s; }
function cut(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 5; i++) { s += h.length; if (i === 2) x.length = 1; } return s; }
function grow(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 5; i++) { s += h.length; x.length = x.length + 1; } return s; }
function named(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { o.length = i; s += h.length; } return s; }
function namedLate(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; if (i === 5) o.length = 7; } return s; }
function field(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += p.list.length; return s; }
function fieldBound(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < p.list.length; i++) { s += 2; if (s > 40) break; } return s; }
function fieldChanged(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += p.list.length; if (i === 4) p.list = other; } return s; }
function fieldPush(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += p.list.length; p.list.push(i); } return s; }
function fieldElements(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < p.list.length && i < 20; i++) s += p.list[i] === undefined ? 1 : 2; return s; }
function fieldCode(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < p.list.length && i < 20; i++) s += p.list.charCodeAt(i); return s; }
function fieldTwo(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) if (p.list.length > q.list.length) s += 3; else s++; return s; }
function fieldSome(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { if (i % 3 === 1) s += p.list.length; else s += i; } return s; }
function rows(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) s += rows[i].length; return s; }
function rowsField(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) s += rows[i].length > p.list.length ? 1 : 10; return s; }
function rowsOf(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (const r of rows) s += r.length; return s; }
function rowsOfBoth(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (const r of rows) s += r.length + h.length; return s; }
function nested(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) s += h.length + rows[i].length; return s; }
function nestedPush(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) { for (let j = 0; j < 3; j++) s += h.length; x.push(i); } return s; }
function nestedBound(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < h.length && i < 9; i++) for (let j = 0; j < h.length && j < 9; j++) s += i; return s; }
function changed(h, x, o, p, q, rows, vals, out, k) { let s = 0; let g = h; for (let i = 0; i < 9; i++) { s += g.length; if (i === 4) g = other; } return s; }
function chosen(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { const g = i & 1 ? h : other; s += g.length; } return s; }
function call(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; if (i === 4) change(x); } return s; }
function callKnown(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; s += size(h); } return s; }
function callEach(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; touch(); } return s; }
function caught(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) try { s += h.length; } catch (e) { s += 100; } return s; }
function caughtAround(h, x, o, p, q, rows, vals, out, k) { let s = 0; try { for (let i = 0; i < 9; i++) { s += i; s += h.length; } } catch (e) { s += 1000; } return s; }
function text(h, x, o, p, q, rows, vals, out, k) { let s = ""; for (let i = 0; i < 9; i++) s += h.length; return s; }
function textGrows(h, x, o, p, q, rows, vals, out, k) { let s = ""; for (let i = 0; i < 9; i++) s += h.length + "," + s.length; return s; }
function stored(h, x, o, p, q, rows, vals, out, k) { for (let i = 0; i < 9; i++) out[i] = h.length; return out.join(); }
function product(h, x, o, p, q, rows, vals, out, k) { let s = 1; for (let i = 0; i < 5; i++) s = s * h.length; return s; }
function negative(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s -= h.length; return s; }
function mod(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += i % h.length; return s; }
function last(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += h[h.length - 1] === undefined ? 1 : 5; return s; }
function or(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += h.length || 50; return s; }
function question(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) s += h?.length ?? 50; return s; }
function plain(h, x, o, p, q, rows, vals, out, k) { let s = []; for (let i = 0; i < 3; i++) s[i] = h.length; return s.map(String).join(); }
function shift(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) { s += h.length; x.shift(); } return s; }
function splice(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) { s += h.length; x.splice(0, 1); } return s; }
function resize(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) { s += h.length; if (i === 1) shrink(); } return s; }
function restart(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += h.length; s += vals[i]; } return s; }
function restartLate(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += vals[i]; s += h.length; out[i] = s; } return String(s) + out.join(); }
function module(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 9; i++) { s += M.length; if (i === 4) M = other; } return s; }
function moduleKept(h, x, o, p, q, rows, vals, out, k) { let s = 0; M = h; for (let i = 0; i < 9; i++) s += M.length; return s; }
function captured(h, x, o, p, q, rows, vals, out, k) { let s = 0; let c = h; const set = v => { c = v; }; for (let i = 0; i < 9; i++) { s += c.length; if (i === 4) set(other); } return s; }
function capturedKept(h, x, o, p, q, rows, vals, out, k) { let s = 0; const add = () => { for (let i = 0; i < 9; i++) s += h.length; }; add(); return s; }
function deleted(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 5; i++) { s += h.length; if (i === 2) delete o.length; } return s; }
function characters(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (let i = 0; i < 4; i++) s += h[i & 1].length; return s; }
function charactersOf(h, x, o, p, q, rows, vals, out, k) { let s = 0; for (const c of h) { s += c.length; if (s > 90) break; } return s; }
function aliasPush(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; x.push(i); } return s; }
function aliasPushInts(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s = (s + g.length) | 0; x.push(i); } return s; }
function aliasPushSome(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; if (i & 1) x.push(i); } return s; }
function aliasPushOnce(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; if (i === 4) x.push(i); } return s; }
function aliasAppend(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; x[x.length] = i; } return s; }
function aliasAppendSome(h, x0, o, p, q, rows, vals, out, k) { const x = [1.5, 2.5]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { if (i & 1) s += g.length; else x[x.length] = i + 0.5; } return s; }
function aliasStore(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; x[i] = i; } return s; }
function aliasStoreIn(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2, 3, 4]; const g = k(x); let s = 0; for (let i = 0; i < 4; i++) { s += g.length; x[i] = i; } return s; }
function aliasPop(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2, 3, 4, 5]; const g = k(x); let s = 0; for (let i = 0; i < 4; i++) { s += g.length; x.pop(); } return s; }
function aliasCut(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2, 3, 4, 5]; const g = k(x); let s = 0; for (let i = 0; i < 4; i++) { s += g.length; x.length = 2; } return s; }
function aliasCutOnce(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2, 3, 4, 5]; const g = k(x); let s = 0; for (let i = 0; i < 4; i++) { s += g.length; if (i === 2) x.length = 1; } return s; }
function aliasShift(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2, 3, 4, 5]; const g = k(x); let s = 0; for (let i = 0; i < 4; i++) { s += g.length; x.shift(); } return s; }
function aliasRecord(h, x0, o, p, q, rows, vals, out, k) { const x = { length: 2 }; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; x.length = i; } return s; }
function aliasRecordSome(h, x0, o, p, q, rows, vals, out, k) { const x = { length: 2 }; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; if (i & 1) x.length = i; } return s; }
function aliasInstance(h, x0, o, p, q, rows, vals, out, k) { const x = new P(2); const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += g.length; x.length += 1; } return s; }
function aliasField(h, x0, o, p, q, rows, vals, out, k) { const x = { list: [1] }; const g = k(x) === x ? x.list : h; const u = k(g); let s = 0; for (let i = 0; i < 9; i++) { s += u.length; x.list.push(i); } return s; }
function aliasFieldNamed(h, x0, o, p, q, rows, vals, out, k) { const x = { list: [1] }; const u = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += u.list.length; x.list.push(i); } return s; }
function aliasFieldSet(h, x0, o, p, q, rows, vals, out, k) { const x = { list: [1] }; const u = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += u.list.length; if (i === 4) x.list = [1, 2, 3]; } return s; }
function aliasBound(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < g.length; i++) { s++; if (i < 5) x.push(i); if (s > 40) break; } return s; }
function aliasNested(h, x0, o, p, q, rows, vals, out, k) { const x = [1]; const g = k(x); let s = 0; for (let j = 0; j < 4; j++) { for (let i = 0; i < 3; i++) s += g.length; x.push(j); } return s; }
function aliasNestedInner(h, x0, o, p, q, rows, vals, out, k) { const x = [1]; const g = k(x); let s = 0; for (let j = 0; j < 4; j++) { s += g.length; for (let i = 0; i < 3; i++) x.push(j); } return s; }
function aliasOf(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (const v of [1, 2, 3, 4]) { s += g.length + v; x.push(v); } return s; }
function aliasCopied(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { s += size(g); add(x, i); } return s; }
function aliasTaken(h, x0, o, p, q, rows, vals, out, k) { const x = [1, 2]; const g = k(x); let s = 0; for (let i = 0; i < 9; i++) { x.push(i); s += g.length + vals[i]; } return String(s) + x.length; }
function doubled(h, x, o, p, q, rows, vals, out, k) { let s = 0.5; for (let i = 0; i < 9; i++) s += h.length / 2; return s; }
const bodies = { sum, sumAny, bound, whileBound, down, some, late, never, equal, less, two, push, pushAll, append, appendSome, storeFar, storeIn, pop, cut, grow, named, namedLate, field, fieldBound, fieldChanged, fieldPush, fieldElements, fieldCode, fieldTwo, fieldSome, rows, rowsField, rowsOf, rowsOfBoth, nested, nestedPush, nestedBound, changed, chosen, call, callKnown, callEach, caught, caughtAround, text, textGrows, stored, product, negative, mod, last, or, question, plain, shift, splice, resize, restart, restartLate, module, moduleKept, captured, capturedKept, deleted, characters, charactersOf, aliasPush, aliasPushInts, aliasPushSome, aliasPushOnce, aliasAppend, aliasAppendSome, aliasStore, aliasStoreIn, aliasPop, aliasCut, aliasCutOnce, aliasShift, aliasRecord, aliasRecordSome, aliasInstance, aliasField, aliasFieldNamed, aliasFieldSet, aliasBound, aliasNested, aliasNestedInner, aliasOf, aliasCopied, aliasTaken, doubled };
const kinds = { ints: () => [1, 2, 3], doubles: () => [1.5, 2.5, 3.5], texts: () => ["a", "bb", "ccc"], mixed: () => [1, "b", null, 2.5], holes: () => [1, , 3], empty: () => [], sized: () => new Array(5), far: () => (() => { const a = [1, 2]; a[100000] = 3; return a; })(), slow: () => (() => { const a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { calls++; return 9; } }); return a; })(), large: () => (() => { const a = []; a.length = 2147483648; return a; })(), largest: () => (() => { const a = []; a.length = 4294967295; return a; })(), frozen: () => Object.freeze([1, 2, 3, 4]), below: () => new (class B extends Array {})(1, 2, 3), belowGetter: () => new (class G extends Array { get length() { calls++; return 4; } })(), literal: () => LIT(), str: () => "abcd", rope: () => "ab" + String(process.argv.length) + "cdefghijklmnop", nostr: () => "", one: () => "x", wide: () => "a\u{1F600}b", strobj: () => new String("abc"), strobjmore: () => Object.assign(new String("abc"), { more: 1 }), u8: () => new Uint8Array(6), f64: () => new Float64Array([1.5, 2.5]), i32: () => new Int32Array([1, 2, 3]), big64: () => new BigInt64Array(3), buf: () => Buffer.from("hello"), resizable: () => RES(), tracking: () => TRACK(), detached: () => (() => { const u = new Uint8Array(6); structuredClone(u.buffer, { transfer: [u.buffer] }); return u; })(), viewown: () => Object.defineProperty(new Uint8Array(4), "length", { value: 77 }), viewbelow: () => new (class V extends Uint8Array { get length() { calls++; return 3; } })(5), dataview: () => new DataView(new ArrayBuffer(8)), args: () => ARGS(1, 2, 3), argsStrict: () => ARGSS(1, 2, 3, 4), argsSet: () => (() => { const a = ARGS(1, 2, 3); a.length = 9; return a; })(), argsStrictSet: () => (() => { const a = ARGSS(1, 2); a.length = 1.5; return a; })(), argsGone: () => (() => { const a = ARGS(1, 2, 3); delete a.length; return a; })(), fn: () => (a, b) => a, fnDefault: () => (a, b = 1) => a, fnOld: () => function (a, b, c) {}, bound: () => (function (a, b, c) {}).bind(null, 1), cls: () => class C { constructor(a) {} }, clsStatic: () => class S { static length = 8; }, clsGetter: () => class SG { static get length() { calls++; return 6; } }, fnSet: () => Object.defineProperty((a, b) => a, "length", { value: 12, configurable: true }), native: () => Math.max, nativeBound: () => Math.max.bind(), obj: () => ({ length: 3 }), objFrac: () => ({ length: 2.5 }), objText: () => ({ length: "4" }), objNaN: () => ({ length: NaN }), objNegZero: () => ({ length: -0 }), objBig: () => ({ length: 2 ** 31 }), objDoubleInt: () => ({ length: DBL }), objNull: () => ({ length: null }), objObj: () => ({ length: { valueOf() { calls++; return 2; } } }), objBigInt: () => ({ length: 3n }), objSym: () => ({ length: Symbol("l") }), none: () => ({}), getter: () => ({ get length() { calls++; return calls % 5; } }), getterThrows: () => ({ get length() { calls++; throw new RangeError("g"); } }), setter: () => ({ set length(v) { calls += v; } }), inherited: () => Object.create({ length: 4 }), inheritedGetter: () => Object.create({ get length() { calls++; return 2; } }), underArray: () => Object.create([1, 2, 3]), nullproto: () => Object.assign(Object.create(null), { length: 5 }), frozenObj: () => Object.freeze({ length: 6 }), many: () => Object.assign({}, Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["k" + i, i])), { length: 4 }), proxy: () => new Proxy([1, 2], { get(t, k) { calls++; return t[k]; } }), proxyPlain: () => new Proxy([1, 2, 3], {}), inst: () => new P(4), instLate: () => (() => { const p = new P(4); p.length = 2; return p; })(), json: () => JSON.parse("[1,2,3,4,5]"), jsonText: () => JSON.parse('"abc"'), jsonObj: () => JSON.parse('{"length":3}'), nul: () => null, undef: () => undefined, num: () => 5, frac: () => 5.5, bool: () => true, sym: () => Symbol("s"), bigint: () => 5n, map: () => new Map([[1, 2]]), regexp: () => /a/, date: () => new Date(0), error: () => new Error("abc"), promise: () => Promise.resolve(1), history: () => HIST };
const valueLists = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, "z", 5, 6, 7, 8, 9], [1, 2, 3, 4, 5.5, 6, 7, 8, 9], JSON.parse("[1,2,3,4,5,6,7,8,9]")];
const show = v => { try { return Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" : typeof v + ":" + String(v); } catch (e) { return "E" + e.name; } };
let total = 0;
for (const b in bodies) for (const k in kinds) {
  if ((b === "shift" || b === "splice") && (k === "large" || k === "largest")) continue;
  let hash = 0;
  for (let round = 0; round < 4; round++) {
    buffer = undefined; M = [1];
    let line = b + " " + k + " " + round;
    const h = kinds[k](), g = kinds[k]();
    // The value itself is the one that is changed, or another is.
    const x = round & 1 ? h : [4, 5, 6], o = round & 1 ? h : { length: 2 };
    const p = { list: h }, q = round & 2 ? { list: other } : p;
    try { line += " " + show(bodies[b](h, x, o, p, q, round & 2 ? [h, other, g, "ab"] : [[1], [1, 2], [], [3]], valueLists[round], [], round & 1 ? v => v : () => h)); } catch (e) { line += " " + e.name; }
    line += " " + calls;
    try { line += " " + (Array.isArray(h) ? h.length : 0); } catch (e) { line += " E"; }
    if (all) console.log(line);
    for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
    total++;
  }
  console.log(b, k, hash);
}
console.log(total, calls);
