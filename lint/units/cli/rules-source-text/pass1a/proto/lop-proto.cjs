// Prototype of the planned port of no-loss-of-precision (no toPrecision, no toString(radix)); compared with ESLint's rule on many literals.
"use strict";
const { Linter } = require("/workspace/ref/eslint/lib/linter");
const linter = new Linter({ configType: "flat" });
const cfg = [{ languageOptions: { ecmaVersion: "latest", sourceType: "script" }, rules: { "no-loss-of-precision": "error" } }];
const eslintSays = raw => { const m = linter.verify(`x = ${raw}`, cfg); if (m.some(x => x.fatal)) return null; return m.length > 0; };

// exact decimal digits of a finite positive double: returns { digits: string (no leading zeros), exp: power of ten of the first digit }
function exactDigits(v) {
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, v);
  const bits = dv.getBigUint64(0);
  const e = Number((bits >> 52n) & 0x7ffn);
  let m = bits & ((1n << 52n) - 1n);
  let k;
  if (e === 0) k = -1074; else { m |= 1n << 52n; k = e - 1075; }
  let s, pointShift; // value = m * 2^k
  if (k >= 0) { s = (m << BigInt(k)).toString(); pointShift = 0; }
  else { s = (m * 5n ** BigInt(-k)).toString(); pointShift = -k; } // value = s / 10^pointShift
  const exp = s.length - 1 - pointShift;
  return { digits: s, exp };
}
// Number.prototype.toPrecision as (digits, exp): half-up on the exact value
function toPrecisionParts(v, p) {
  let { digits, exp } = exactDigits(v);
  digits = digits.padEnd(p + 1, "0");
  let head = digits.slice(0, p).split("").map(Number);
  if (digits.charCodeAt(p) >= 53) { // '5'
    let i = p - 1;
    while (i >= 0 && head[i] === 9) { head[i] = 0; i--; }
    if (i < 0) { head = [1, ...head.slice(0, p - 1)]; exp += 1; } else head[i]++;
  }
  return { coefficient: head.join(""), magnitude: exp };
}
const rlz = s => { for (let i = 0; i < s.length; i++) if (s[i] !== "0") return s.slice(i); return s; };
const rtz = s => { for (let i = s.length - 1; i >= 0; i--) if (s[i] !== "0") return s.slice(0, i + 1); return s; };
function planned(rawWithSep, value) {
  const raw = rawWithSep; // isBaseTen reads the raw with separators
  const lower2 = raw.slice(0, 2).toLowerCase();
  const prefixed = lower2 === "0x" || lower2 === "0b" || lower2 === "0o";
  const legacy = /^0[0-7]+$/.test(raw);
  if (prefixed || legacy) {
    const bitsPer = lower2 === "0x" ? 4 : lower2 === "0b" ? 1 : 3;
    const digits = (prefixed ? raw.slice(2) : raw).replace(/_/g, "");
    let first = -1, last = -1;
    for (let i = 0; i < digits.length; i++) if (digits[i] !== "0") { if (first < 0) first = i; last = i; }
    if (first < 0) return false;
    const dv = c => parseInt(c, 16);
    const top = dv(digits[first]), low = dv(digits[last]);
    const bl = 32 - Math.clz32(top);
    const total = bl + bitsPer * (digits.length - 1 - first);
    const tz = 31 - Math.clz32(low & -low);
    const trailing = bitsPer * (digits.length - 1 - last) + tz;
    return total - trailing > 53 || total > 1024;
  }
  let s = raw.replace(/_/g, "").toLowerCase();
  // remove a '.' followed by 'e' or by the end
  const dot = s.indexOf(".");
  if (dot >= 0 && (dot === s.length - 1 || s[dot + 1] === "e")) s = s.slice(0, dot) + s.slice(dot + 1);
  const ei = s.indexOf("e");
  const coef = ei < 0 ? s : s.slice(0, ei);
  let coefficient, magnitude;
  if (s.includes(".")) {
    const t = rlz(coef); const i = t.indexOf(".");
    if (i === 0) { const sig = rlz(t.slice(1)); coefficient = sig; magnitude = sig.length - t.length; }
    else { coefficient = t.replace(".", ""); magnitude = i - 1; }
  } else { const t = rlz(coef); coefficient = rtz(t); magnitude = t.length - 1; }
  if (ei >= 0) magnitude += parseInt(s.slice(ei + 1), 10);
  if (value === 0) return !/^0+$/.test(coefficient);
  if (coefficient.length > 100) return true;
  if (!Number.isFinite(value)) return true;
  const st = toPrecisionParts(value, coefficient.length);
  return st.magnitude !== magnitude || st.coefficient !== coefficient;
}
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = s => s[rnd(s.length)];
function gen() {
  const kind = rnd(12);
  const digs = (n, set) => Array.from({ length: n }, () => pick(set)).join("");
  const sep = s => (rnd(6) === 0 && s.length > 2 ? s.slice(0, 1) + "_" + s.slice(1) : s);
  switch (kind) {
    case 0: return pick(["0x", "0X"]) + sep(digs(1 + rnd(20), "0123456789abcdefABCDEF00"));
    case 1: return pick(["0b", "0B"]) + sep(digs(1 + rnd(70), "01"));
    case 2: return pick(["0o", "0O"]) + sep(digs(1 + rnd(25), "01234567"));
    case 3: return "0" + digs(1 + rnd(24), "01234567");
    case 4: return sep(pick("123456789") + digs(rnd(25), "0123456789"));
    case 5: return sep(pick("123456789") + digs(rnd(22), "0123456789")) + "0".repeat(rnd(12));
    case 6: return digs(1 + rnd(3), "0123456789").replace(/^0+(?=\d)/, "") + "." + digs(rnd(22), "0123456789");
    case 7: return "." + "0".repeat(rnd(5)) + digs(1 + rnd(20), "0123456789");
    case 8: return (pick("123456789") + digs(rnd(18), "0123456789")) + pick(["e", "E"]) + pick(["", "+", "-"]) + String(rnd(330));
    case 9: return digs(1 + rnd(2), "123456789") + "." + digs(rnd(20), "0123456789") + pick(["e", "E"]) + pick(["", "+", "-"]) + String(rnd(330));
    case 10: return "0." + "0".repeat(rnd(320)) + digs(1 + rnd(18), "0123456789");
    default: return pick("123456789") + digs(14 + rnd(4), "0123456789") + "." + digs(1 + rnd(3), "0123456789");
  }
}
const fixed = ["562949953421312.13", "562949953421312.12", "0", "0.0", "0.", ".0", "0e0", "1e999", "1e-999", "5e-324", "4.9e-324", "2.5e-324", "2.4e-324", "1.7976931348623157e308", "1.7976931348623158e308", "1.7976931348623159e308", "08", "09.5", "019", "00", "0777", "0x" + "f".repeat(13) + "8" + "0".repeat(242), "0x" + "f".repeat(13) + "8" + "0".repeat(243), "0x1" + "0".repeat(255), "0x1" + "0".repeat(256), "0b" + "1".repeat(53), "0b" + "1".repeat(54), "9007199254740993", "9007199254740992", "900719925474099.3e1", "1." + "0".repeat(99), "1." + "0".repeat(100), "0." + "0".repeat(400) + "1", "1" + "0".repeat(400), "0x0", "0b0_0", "0o0", "1_0.0_1", "1.e5", "1.E5", "5.e-1", "2.2250738585072014e-308", "2.2250738585072011e-308", "4.4501477170144023e-308"];
let n = 0, bad = 0, skipped = 0;
const all = [...fixed]; for (let i = 0; i < 60000; i++) all.push(gen());
for (const raw of all) {
  let value; try { value = Function(`return ${raw}`)(); } catch { skipped++; continue; }
  const e = eslintSays(raw); if (e === null) { skipped++; continue; }
  const p = planned(raw, value); n++;
  if (p !== e) { bad++; if (bad <= 25) console.log("DIFF", raw, "eslint", e, "planned", p); }
}
console.log({ compared: n, differences: bad, skipped });
