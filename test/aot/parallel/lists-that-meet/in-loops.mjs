const out = [];
const show = v => (v instanceof Error ? v.name + ":" + v.message : Array.isArray(v) ? "[" + v.length + "|" + Object.keys(v).map(k => k + ":" + show(v[k])) + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])) + "}" : typeof v === "function" ? "function" : String(v));
const log = (...values) => out.push(values.map(show).join(" "));
const list = JSON.parse("[3,0,51,12,8,99,7,50,-1,4]"), mixed = JSON.parse('[1,"2",null,4.5,true,60]'), doubles = [0.5, -0, 2.5];
let held = null, state = 0;
const minmax = (a, b) => (a < b ? [a, b] : [b, a]);
function order(a, b) { if (a < b) return [a, b]; return [b, a]; }
function divide(a, b) { if (b === 0) return [new RangeError("zero"), 0]; return [null, (a / b) | 0]; }
function rgb(v) { if (v < 10) return [v, 0, 0]; if (v < 60) return [0, v, 0]; return [0, 0, v]; }
function lengths(v) { if (v & 1) return [v]; return [v >> 1, v & 7]; }
function holes(v) { return v & 1 ? [v, , 3] : [1, 2, v]; }
function changed(v) { let made = v & 1 ? [v, 1] : [2, v]; if (v > 10) made[1] = "late"; if (v > 50) made.push(7); if (v === 8) held = made; return made; }
function attempt(v) { try { if (v < 0) throw new Error("below"); return [null, v + 1]; } catch (error) { return [error, 0]; } finally { state++; } }
function closures(v) { return v & 1 ? [() => v, 1] : [() => -v, 2]; }
function nested(v) { return v & 1 ? [[v, 1], { z: v }] : [[2, v], { z: -v }]; }
function frozen(v) { return v & 1 ? Object.freeze([v, 1]) : [v, 2]; }
function numbers(source) { let s = 0; for (let i = 0; i < source.length; i++) { const x = source[i]; const [lo, hi] = minmax(x, i); s += hi * 2 - lo; const p = order(x, i); s += p[1] - p[0] + p.length; const [a, b] = x > i ? [x, i] : [i, x]; s += a * 3 - b; const [r, g, b2] = rgb(x); s += r * 3 + g * 5 + b2; const [error, q] = divide(i, x); s += error ? error.message.length : q; let t = [x, i]; if (i & 1) t = [i, x]; s += t[0] * 3 - t[1]; } return s; }
function kept(source) { const all = []; for (let i = 0; i < source.length; i++) { const x = source[i]; const p = order(x, i); if (i & 1) all.push(p); else { p[0] = "set"; p.push(i); all.push(p); } const c = changed(x); all.push(c, c === held); const h = holes(x); all.push(h, 1 in h); const [v, w = "none"] = lengths(x); all.push(v, w); } return all; }
function others(source) { for (let i = 0; i < source.length; i++) { const x = source[i]; const [error, v] = attempt(x); log(error, v); const [f, n] = closures(x); log(f(), n); const [[a, b], o] = nested(x); o.z++; log(a, b, o); const z = frozen(x); log(Object.isFrozen(z), z); const k = minmax(x, i); log(k.map(w => w), [...k], k.indexOf(i), JSON.stringify(k)); for (const w of order(x, i)) log(w); let [p, q] = minmax(x, i); [p, q] = [q, p]; log(p, q); } }
function steps(a, b) { for (let k = 0; k < 40 && a !== b; k++) { const [c, d] = a > b ? [a - b, b] : [a, b - a]; a = c; b = d; } return a; }
for (let round = 0; round < 3; round++) { log(numbers(list), numbers(doubles), numbers(mixed), steps(48, 18), steps(17, 5), state); log(kept(list)); others(list); others(mixed); log(held); }
console.log(out.join("\n"));
