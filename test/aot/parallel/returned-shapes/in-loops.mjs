const out = [];
const show = v => (v instanceof Error ? v.name + ":" + v.message : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.map(show) + "]" : "{" + Object.keys(v).map(k => k + ":" + show(v[k])) + "}") : String(v));
const log = (...values) => out.push(values.map(show).join(" "));
const list = JSON.parse("[3,0,51,12,8,99,7,50,-1,4]"), mixed = JSON.parse('[1,"2",null,4.5,true,60]');
let state = 0, held = null, done = 0;
const ok = value => ({ ok: true, value }), err = error => ({ ok: false, error });
function half(v) { if (v & 1) return { ok: false, error: "odd" }; return { ok: true, value: v >> 1 }; }
function parse(v) { if (v < 10) return { kind: "small", v }; if (v < 50) return { kind: "middle", v, w: v * 2 }; return { kind: "large", v, w: 1, z: 2 }; }
function find(v) { if (v > 50) return null; return { v }; }
function seek(v) { if (v > 50) return; return { v, w: 2 }; }
function attempt(v) { try { return { ok: true, v: v + 1 }; } catch (error) { return { ok: false, error }; } }
function positive(v) { if (v < 5) throw new RangeError("small " + v); return v; }
function tried(v) { try { return { ok: true, v: positive(v) }; } catch (error) { return { ok: false, error }; } finally { done++; } }
function keeps(v) { const made = { ok: v > 5, v }; if (v === 8) { held = made; return made; } return v === 12 ? held : { ok: false, late: v }; }
function getter(v) { return v & 1 ? { get ok() { state++; return true; }, value: v } : { ok: false, value: -v, extra: 1 }; }
const map = (result, f) => (result.ok ? { ok: true, value: f(result.value) } : result);
function folds() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; const r = half(x); s = (s + (r.ok ? r.value : r.error.length)) | 0; const q = parse(x); s = (s + (q.kind === "small" ? q.v : q.kind === "middle" ? q.w : q.z)) | 0; switch (parse(x).kind) { case "small": s += 1; break; case "middle": s += 20; break; default: s += 300; } const m = map(half(x), v => v + 1); if (!m.ok) { s -= 2; continue; } s += m.value; } return s; }
function presence() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; const r = find(x); if (r) s += r.v; else s += 1000; const q = seek(x); if (q !== undefined) s += q.v * q.w; if (q == null) s += 7; s += find(x)?.v ?? 5; if (!seek(x)) s += 11; if (find(x) === null) s += 13; } return s; }
function tries() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; const r = attempt(x); s += r.ok ? r.v : 0; const q = tried(x); if (q.ok) s += q.v; else log(q.error, q); } return s; }
function escapes() { const kept = []; for (let i = 0; i < list.length; i++) { const x = list[i]; const r = half(x); if (r.ok) kept.push(r); else { r.error += "!"; r.more = i; kept.push(r); } const q = keeps(x); if (q?.ok) log(held === q, q); else log(q); const f = find(x); if (f) { f.v++; kept.push(f); } } return kept; }
function accessors() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; const r = getter(x); if (r.ok) s += r.value; else s += Object.keys(r).length; } return s; }
function values() { for (let i = 0; i < mixed.length; i++) { const x = mixed[i]; const r = attempt(x); if (r.ok) log(r.v); const f = find(x); log(f ? f.v : "nothing", half(x).ok); const q = i & 1 ? ok(x) : err(x); log(q.ok ? q.value : q.error, q); } }
class Reader { constructor() { this.at = 0; } next() { return this.at < list.length ? { value: list[this.at++], done: false } : { value: undefined, done: true }; } }
function reads() { let s = 0; const reader = new Reader(); for (;;) { const r = reader.next(); if (r.done) break; s += r.value; } return s; }
function turn(x) { const r = half(x); if (r.ok) return r.value; const f = find(x); return f ? -f.v : 1; }
function nested() { let s = 0; for (let i = 0; i < list.length; i++) s += turn(list[i]); return s; }
for (let round = 0; round < 3; round++) { log(folds(), presence(), tries(), accessors(), reads(), nested(), state, done); log(escapes()); values(); }
console.log(out.join("\n"));
