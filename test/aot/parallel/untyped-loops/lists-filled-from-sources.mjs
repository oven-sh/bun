// Lists filled out of one or two lists, by push under conditions, by index, into rows; sources that change their kind and that are the filled list.
function f0(a, b, keep) { const out = [0], rest = []; let i = 0, j = 0, s = 0; for (; i < a.length; i++) { if (a[i] % 2 === 0) out.push(a[i]); else if (a[i] > 4) rest.push(a[i]); } s += out.length; return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f1(a, b, keep) { const out = [], rest = []; let i = 0, j = 0, s = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f2(a, b, keep) { const out = [], rest = []; let i = 0, j = 0, s = 0; for (; i < a.length; i++) { const row = []; for (let k = 0; k < b.length; k++) row.push(a[i] * b[k]); out.push(row.length); s += row[0] ?? 0; }  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f3(a, b, keep) { const out = [0.5], rest = []; let i = 0, j = 0, s = 0; for (const x of a) { let k = out.length; out.push(x); while (k > 0 && out[k - 1] > x) { out[k] = out[k - 1]; k--; } out[k] = x; }  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f4(a, b, keep) { const out = [0.5], rest = []; let i = 0, j = 0, s = 0; for (; i < a.length; i++) { if (a[i] % 2 === 0) out.push(a[i]); else if (a[i] > 4) rest.push(a[i]); } s += out.length; return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f5(a, b, keep) { const out = [], rest = []; let i = 0, j = 0, s = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f6(a, b, keep) { const out = [0], rest = []; let i = 0, j = 0, s = 0; while (i < a.length && j < b.length) out.push((a[i] < b[j] ? a[i++] : b[j++]) + 1); while (i < a.length) out.push(a[i++]); while (j < b.length) out.push(b[j++]);  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
function f7(a, b, keep) { const out = [], rest = []; let i = 0, j = 0, s = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { out.push(a[i]); i++; j++; } else if (a[i] < b[j]) i++; else j++; }  return out.map(show).join(" ") + "|" + rest.map(show).join(" ") + "|" + show(s); }
const show = v => Object.is(v, -0) ? "-0" : String(v);
const kept = [];
const a0 = [0.5, 1.5, 4], b0 = [3, , 5];
const a1 = [0.5, 1.5, 4], b1 = [3, , 5];
const a2 = [1, 4, 7, 9], b2 = Array.from({ length: 9 }, (_, i) => i * 4);
const a3 = [5, 4, 3, -1, 2147483647], b3 = [];
const a4 = [1, , 3, 9], b4 = [2, 3, 8];
const a5 = [1, , 3, 9], b5 = [2, 3, 8];
const a6 = [1, , 3, 9], b6 = [1, 2, 2.5, 9];
const a7 = [2, 3, 8, 11, 20], b7 = [];
for (let round = 0; round < 16; round++) {
    const said = [f0(a0, b0, round % 5 === 4 ? kept : null), f1(a1, b1, round % 5 === 4 ? kept : null), f2(a2, b2, round % 5 === 4 ? kept : null), f3(a3, b3, round % 5 === 4 ? kept : null), f4(a4, b4, round % 5 === 4 ? kept : null), f5(a5, b5, round % 5 === 4 ? kept : null), f6(a6, b6, round % 5 === 4 ? kept : null), f7(a7, b7, round % 5 === 4 ? kept : null)];
    if (round < 4 || round > 13) console.log(round, said.map(t => t.length > 160 ? t.length + t.slice(0, 120) : t).join("\n"));
    if (round === 7) { a0.push(6); a1.push(6); a2.push(0.5); a3.push(undefined); a4.push(0.5); a5.push(0.5); a6.push(undefined); a7.push(undefined); }
    if (round === 11) { b0.unshift(0); b1.unshift(-3); b2.unshift(1.5); b3.unshift(1.5); b4.unshift(-3); b5.unshift(1.5); b6.unshift(0); b7.unshift(-3); }
}
console.log(kept.length, kept.map(l => l.length).join());
console.log(f0(a1, a1, null), f1(b2, b2, kept), f6(kept.length ? kept[0] : [], [1, 2], null).length);
