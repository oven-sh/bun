const out = [];
const log = (...values) => out.push(values.join(" "));
const list = JSON.parse("[3,0,51,12,8,99,7,50,-1,4]"), doubles = JSON.parse("[1.5,60.25,-0,3]"), mixed = JSON.parse('[1,"2",null,4.5,true,60]');
const bytes = new Uint8Array([3, 200, 8, 51]), wide = new Float64Array([0.5, 70, 2]);
function half(v) { if (v & 1) return { ok: false, error: "odd" }; return { ok: true, value: v >> 1 }; }
function find(v) { if (v > 50) return null; return { v }; }
function kind(v) { if (v > 50) return { kind: "big", v }; if (v < 4) return { kind: "small", least: v }; return { kind: "middle" }; }
function parse(v) { if (v === 8) throw new RangeError("eight"); return { got: v }; }
function attempt(v) { try { return { ok: true, value: parse(v).got }; } catch (error) { return { ok: false, error }; } }
let s = 0, said = "";
for (let round = 0; round < 3; round++) for (let i = 0; i < list.length; i++) { const r = half(list[i]); s = (s + (r.ok ? r.value : r.error.length)) | 0; }
log(s);
for (const source of [list, doubles, mixed, bytes, wide]) for (let i = 0; i < source.length; i++) { const r = find(source[i]); if (r) s = (s + Number(r.v)) | 0; else said += i; }
log(s, said);
for (const source of [bytes, list, wide, mixed]) for (let i = 0; i < source.length; i++) { s = (s + (find(source[i])?.v ?? 1)) | 0; }
log(s);
function run(source) { let t = 0; for (let i = 0; i < source.length; i++) { const r = kind(source[i]); switch (r.kind) { case "big": t += Number(r.v); break; case "small": t -= Number(r.least); break; default: t += 1000; } } return t; }
for (let round = 0; round < 2; round++) for (const source of [list, bytes, doubles, wide, mixed]) log(run(source));
function tries(source) { let t = ""; for (let i = 0; i < source.length; i++) { const r = attempt(source[i]); if (r.ok) t += r.value; else t += r.error.message; } return t; }
for (const source of [list, bytes, doubles, wide, mixed]) log(tries(source));
for (let i = 0; i < mixed.length; i++) { const r = attempt(mixed[i]); if (r.ok) s += Number(r.value) || 2; else said += r.error.name; }
for (let i = 0; i < bytes.length; i++) { const r = attempt(bytes[i]); if (r.ok) s += r.value; else said += r.error.name; }
log(s, said);
console.log(out.join("\n"));
