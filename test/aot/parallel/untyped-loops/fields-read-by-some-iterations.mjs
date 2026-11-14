// fields read by some iterations alone, off holders of every kind that no iteration changes, or that some do
let calls = 0, hash = 0, lines = 0; const all = process.argv.includes("all"); function f(c) { try { c.k = 8; } catch {} }
function store(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i & 1) y[i] = c.k; return y; }
function storeElse(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i > 5) y[i] = c.k; else y[i] = i; return y; }
function never(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i > 99) y[i] = c.k; return y; }
function last(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i === y.length - 1) y[i] = c.k; return y; }
function sum(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) if (i % 3 === 0) s += c.k; return [s]; }
function sumOf(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) s += i & 1 ? y[i] * c.k : y[i]; return [s]; }
function clamp(y, c, d, z, w) { for (let i = 0; i < y.length; i++) y[i] = y[i] < c.k ? c.k : y[i] > c.m ? c.m : y[i]; return y; }
function compare(y, c, d, z, w) { let n = 0; for (let i = 0; i < y.length; i++) if (i & 2) if (y[i] === c.k) n++; return [n]; }
function changes(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i & 1) { y[i] = c.k; if (i === 5) c.k = 9; } return y; }
function deletes(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i & 1) { y[i] = c.k; if (i === 5) delete c.k; } return y; }
function other(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (i & 1) { y[i] = c.k; d.k = i; } return y; }
function nested(y, c, d, z, w) { for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) if (i !== k) y[k * 4 + i] = c.k; return y; }
function inner(y, c, d, z, w) { let s = 0; for (let k = 0; k < 4; k++) { if (k & 1) for (let i = 0; i < y.length; i++) if (i & 1) s += c.k; } return [s]; }
function twice(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) s += c.k; if (i & 2) s -= c.k; } return [s]; }
function deep(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) if (i & 1) s += c.deep.k; return [s]; }
function called(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) { if (i & 1) s += c.k; if (i === 7) f(c); } return [s]; }
function caught(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) try { if (i & 1) s += c.k; } catch (e) { s += 100; } return [s]; }
function guarded(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) if (c) s += c.k; return [s]; }
function push(y, c, d, z, w) { const o = []; for (let i = 0; i < y.length; i++) if (i & 1) o.push(c.k); return o; }
function text(y, c, d, z, w) { let s = ""; for (let i = 0; i < y.length; i++) if (i & 1) s += c.k; return [s]; }
function switched(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) switch (i % 4) { case 0: s += c.k; break; case 1: s -= c.k; break; default: s++; } return [s]; }
function whiled(y, c, d, z, w) { let i = 0, s = 0; while (i < y.length) { if (y[i++] > 3) s += c.k; } return [s]; }
function of(y, c, d, z, w) { let s = 0; for (const v of y) if (v > 3) s += c.k; return [s]; }
function broken(y, c, d, z, w) { let s = 0; for (let i = 0; i < y.length; i++) { if (i === 6) { s += c.k; break; } s++; } return [s]; }
function invariantStore(y, c, d, z, w) { for (let i = 0; i < y.length; i++) if (y[i] > 3) z[i] = w; return z; }
function invariantElse(y, c, d, z, w) { for (let i = 0; i < y.length; i++) z[i] = i & 1 ? w : y[i]; return z; }
const bodies = { store, storeElse, never, last, sum, sumOf, clamp, compare, changes, deletes, other, nested, inner, twice, deep, called, caught, guarded, push, text, switched, whiled, of, broken, invariantStore, invariantElse };
const holders = { num: () => ({ k: 2.5 }), int: () => ({ k: 3 }), str: () => ({ k: "s" }), nan: () => ({ k: NaN }), undef: () => ({ k: undefined }), none: () => ({}), nul: () => null, undefined_: () => undefined, getter: () => ({ get k() { return ++calls; } }), proxy: () => new Proxy({ k: 7 }, { get(t, key) { calls++; return t[key]; } }), inherited: () => Object.create({ k: 4.5 }), frozen: () => Object.freeze({ k: 1.5 }), big: () => ({ k: 5n }), arr: () => Object.assign([1, 2], { k: 6 }), prim: () => "text", number: () => 5, obj: () => ({ k: { valueOf() { calls++; return 2; } } }), negzero: () => ({ k: -0 }), bool: () => ({ k: true }) };
const lists = { doubles: () => Array.from({ length: 12 }, (_, i) => (x => x + 0.5)(i)), ints: () => Array.from({ length: 12 }, (_, i) => (x => x)(i)), mixed: () => Array.from({ length: 12 }, (_, i) => (x => x % 3 ? x : x + 0.25)(i)), strings: () => Array.from({ length: 12 }, (_, i) => (x => "t" + x)(i)), holes: () => { const a = [1.5, , 3, 4.5]; a.length = 12; a[11] = 2; return a; }, objects: () => Array.from({ length: 12 }, (_, i) => (x => ({ x }))(i)), undefs: () => Array.from({ length: 12 }, (_, i) => (x => x % 4 ? x : undefined)(i)) };
function show(v) { try { return Array.isArray(v) ? "[" + Array.from(v, x => Object.is(x, -0) ? "-0" : typeof x === "object" && x !== null ? "o" : String(x)).join(",") + "]" : String(v); } catch (e) { return "E" + e.name; } }
for (const b in bodies) for (const h in holders) { hash = 0; for (const l in lists) {
  let line = b + " " + h + " " + l;
  for (let round = 0; round < 3; round++) {
    const y = lists[l](), c = holders[h](), d = round ? {} : c, z = lists[round === 1 ? "ints" : round === 2 ? "strings" : "doubles"]();
    if (c !== null && typeof c === "object" && Object.isExtensible(c)) { try { c.m = 4; c.deep = { k: round }; } catch {} }
    let w; try { w = c === null || c === undefined ? c : c.k; } catch {}
    try { line += " " + show(bodies[b](y, c, d, z, w)) + show(y) + calls; } catch (e) { line += " " + e.name + ":" + e.message + show(y) + calls; }
  }
  lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
  if (all) console.log(line);
} console.log(b, h, hash); }
console.log(lines, calls);
