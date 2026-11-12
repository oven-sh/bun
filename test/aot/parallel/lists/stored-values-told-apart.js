// Loops that store a value that no iteration changes, into lists that nobody types.
// STATISTIC: StoredValuesDistinguished >= 8
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 307 === 1) said.push(text.slice(0, 170)); }
function show(x, d = 0) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : d > 1 ? "..." : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 14) }, (_, i) => i in x ? show(x[i], d + 1) : "_").join() + "]" + x.length + Object.keys(x).filter(k => !(k >= 0)) : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const got = (o, name, value) => Object.defineProperty(o, name, { get() { calls++; return value; }, set(v) { calls += 100; value = v; }, enumerable: true, configurable: true });
const counting = v => ({ valueOf() { calls++; return v; } });
const values = [() => 0, () => 7, () => -1, () => -0, () => 0.5, () => NaN, () => Infinity, () => 2147483647, () => 2147483648, () => 1e300, () => "t", () => "", () => undefined, () => null, () => true, () => 3n, () => Symbol.iterator, () => counting(2), () => [1], () => () => 1];
const lists = [() => [1, 2, 3, 4, 5, 6, 7, 8], () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], () => ["a", "b", "c", "d", "e", "f", "g", "h"], () => [1, , 3, , 5, , 7, ,], () => [, 1.5, , 2.5, , , , ,], () => new Array(8), () => [], () => new Array(8).fill(0), () => new Array(8).fill(0.5), () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), () => Object.seal([1.5, 2, 3, 4, 5, 6, 7, 8]), () => new Int8Array(8), () => new Uint8ClampedArray(8), () => new Float64Array(8), () => new Float32Array(8), () => got([1, 2, 3, 4, 5, 6, 7, 8], 3, 9), () => new (class extends Array {})(1, 2, 3, 4, 5, 6, 7, 8), () => ({ length: 8, 0: 1 }), () => "letters!", () => new Proxy([1, 2, 3, 4, 5, 6, 7, 8], { set(t, k, v) { calls++; t[k] = v; return true; }, get(t, k) { calls += 10; return t[k]; } }), () => { const a = [1, 2, 3, 4, 5, 6, 7, 8]; a.name = 1; return a; }, () => [NaN, -0, Infinity, 4, 5, 6, 7, 8], () => [2147483647, -2147483648, 3, 4, 5, 6, 7, 8]];
function upToLength(c, w) { for (let i = 0; i < c.length; i++) c[i] = w; return c; }
function upToNumber(c, w) { for (let i = 0; i < 6; i++) c[i] = w; return c; }
function beyond(c, w) { for (let i = 0; i < 11; i++) c[i] = w; return c; }
function some(c, w) { for (let i = 0; i < c.length; i++) if (i & 1) c[i] = w; return c; }
function either(c, w, v) { for (let i = 0; i < c.length; i++) c[i] = i & 1 ? w : v; return c; }
function bothArms(c, w, v) { for (let i = 0; i < c.length; i++) if (i % 3) c[i] = w; else c[i] = v; return c; }
function down(c, w) { for (let i = c.length - 1; i >= 0; i--) c[i] = w; return c; }
function during(c, w) { let i = 0; while (i < c.length) c[i++] = w; return c; }
function steps(c, w) { for (let i = 0; i < c.length; i += 2) c[i] = w; return c; }
function first(c, w) { const v = w[0]; for (let i = 0; i < c.length; i++) c[i] = v; return c; }
function counts(c, w) { let n = 0; for (let i = 0; i < c.length; i++) { if (c[i] === w) n++; c[i] = w; } return n; }
function adds(c, w) { let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; c[i] = w; } return s; }
function scaled(c, w) { for (let i = 0; i < c.length; i++) { c[i] = w; c[i] = c[i] * 2; } return c; }
function twoLists(c, w, v) { const b = [0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 8; i++) { b[i] = w; c[i] = v; } return b.concat(c); }
function rows(c, w) { const g = [c, [1, 2, 3], c]; for (const r of g) for (let i = 0; i < r.length; i++) r[i] = w; return g; }
function table(c, w) { const g = [[1, 2], c, [0.5, 1.5]]; for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) g[y][x] = w; return g; }
function flat(c, w) { for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) c[y * 4 + x] = w; return c; }
function named(c, w) { const h = JSON.parse('{"z":1}'); h.value = w; for (let i = 0; i < c.length; i++) c[i] = h.value; return c; }
function listed(c, w) { const h = JSON.parse('{"z":1}'); h.items = c; for (let i = 0; i < h.items.length; i++) h.items[i] = w; return c; }
function itself(c, w) { for (let i = 0; i < c.length; i++) c[i] = c; return c.length; }
function made(c, w) { const b = new Array(8); for (let i = 0; i < 8; i++) b[i] = w; return b; }
function pushed(c, w) { const b = []; for (let i = 0; i < 8; i++) b.push(w); return b; }
function literal(c, w) { const b = [1, 2, 3, 4, 5, 6, 7, 8]; for (let i = 0; i < 8; i++) b[i] = w; let s = 0; for (let i = 0; i < 8; i++) s += b[i]; return [b, s]; }
function caught(c, w) { let i = 0; try { for (; i < 10; i++) { c[i] = w; if (i === 5) throw i; } } catch (e) { return [e, i, c]; } return c; }
for (const f of [upToLength, upToNumber, beyond, some, either, bothArms, down, during, steps, first, counts, adds, scaled, twoLists, rows, table, flat, named, listed, itself, made, pushed, literal, caught]) for (const c of lists) for (let k = 0; k < values.length; k++) { calls = 0; const l = c(), w = values[k](), v = values[(k * 7 + 3) % values.length](); let answer; try { answer = show(f(l, w, v)); } catch (x) { answer = x && x.constructor ? x.constructor.name : typeof x; } keep(f.name + " " + answer + show(l) + calls); if (k % 5 === 0) { let again; try { again = show(f(l, values[(k + 5) % values.length](), w)); } catch (x) { again = x.constructor.name; } keep(f.name + " again " + again); } }
console.log(cases, digest); for (const x of said) console.log(x);
