// Emits doubles with what ESLint's convertNumberToScientificNotation(value.toPrecision(p), true) gives.
"use strict";
const rlz = s => { for (let i = 0; i < s.length; i++) if (s[i] !== "0") return s.slice(i); return s; };
function normalizeFloat(f) { const t = rlz(f); const i = t.indexOf("."); if (i === 0) { const sig = rlz(t.slice(1)); return [sig, sig.length - t.length]; } if (i === -1) return [t, t.length - 1]; return [t.replace(".", ""), i - 1]; }
function sci(s) { const parts = s.split("e"); const r = normalizeFloat(parts[0]); if (parts.length > 1) r[1] += parseInt(parts[1], 10); return r; }
const dv = new DataView(new ArrayBuffer(8));
let seed = 987654321n; const step = () => { seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return seed; }; const rnd = () => (step() >> 11n) ^ (step() << 20n & 0xffffffffffffffffn);
const out = [];
const emit = (v, p) => { if (!Number.isFinite(v) || v <= 0) return; dv.setFloat64(0, v); const [c, m] = sci(v.toPrecision(p)); out.push(`${dv.getBigUint64(0).toString(16)} ${p} ${c} ${m}`); };
for (const v of [5e-324, 4.9e-324, 1.7976931348623157e308, 2.2250738585072014e-308, 0.1, 0.5, 0.25, 0.125, 1, 2.5, 562949953421312.125, 9007199254740992, 1e21, 1e-7, 123456789, 0.30000000000000004, 999999999999999.9, 9.999999999999999e22, 1e23])
  for (const p of [1, 2, 3, 15, 16, 17, 18, 21, 50, 100]) emit(v, p);
for (let i = 0; i < 200000; i++) { dv.setBigUint64(0, rnd() & 0x7fffffffffffffffn); const v = dv.getFloat64(0); emit(v, 1 + Number(rnd() % 100n)); }
for (let i = 0; i < 50000; i++) { const v = Number(rnd() % 100000n) / 2 ** Number(rnd() % 20n); emit(v, 1 + Number(rnd() % 12n)); }
process.stdout.write(out.join("\n") + "\n");
