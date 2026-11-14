// Pushes onto lists that a function makes, of elements of other lists: int32s, holes, doubles, texts, undefined; lists born empty, with elements, of another kind; sites that change kind from call to call.
function f0(l, m, kept) { const out = [undefined]; for (let i = l.length - 1; i >= 0; i--) { const k = i; out.push(l[i + 1] + 1); } return out.map(show).join("|"); } const l0 = [1, undefined, 2, null];
function f1(l, m, kept) { const out = kept; for (let i = 0; i < 4; i++) { for (let k = 0; k < 2; k++) { const v = l[k]; if (v !== undefined) out.push(v); } out.push(l[i]); } return out.map(show).join("|"); } const l1 = [1, undefined, 2, null];
function f2(l, m, kept) { const out = [undefined]; let i = 0, k = 0; while (i < l.length && k < m.length) { out.push(l[k] < l[i] ? l[k] : l[i]); if (l[i] < m[k]) i++; else k++; } return out.join(); } const l2 = [1, undefined, 2, null];
function f3(l, m, kept) { const out = [undefined]; let i = 0, k = 0; while (i < l.length && k < m.length) { out.push(l[i - 1]); if (l[i] < m[k]) i++; else k++; } return out.reduce((s, v) => s + v, 0); } const l3 = Array.from({ length: 40 }, (_, i) => i * 7);
function f4(l, m, kept) { const out = []; for (let i = 0; i < 4; i++) { for (let k = 0; k < 2; k++) { const v = l[k & 3]; if (v !== undefined) out.push(v); } out.push(l[i]); } return out.reduce((s, v) => s + v, 0); } const l4 = [1, 2, 3, 4];
function f5(l, m, kept) { const out = []; let i = 0; while (i < l.length) { const k = i; out.push(i & 1 ? l[i + 1] : i); i++; } return out.length + ":" + out.map(show).join(" "); } const l5 = [-0, 0, 1];
function f6(l, m, kept) { const out = kept; let i = 0, k = 0; while (i < l.length && k < m.length) { out.push(l[i] + 1); if (l[i] < m[k]) i++; else k++; } return out.map(show).join("|"); } const l6 = [-0, 0, 1];
function f7(l, m, kept) { const out = []; let i = 0; while (i < l.length) { const k = i; out.push(l[i] < l[i] ? l[i] : l[i]); i++; } return out.join(); } const l7 = Array.from({ length: 40 }, (_, i) => i * 7);
function show(v) { return Object.is(v, -0) ? "-0" : String(v); }
const others = [[2, 3, 8], [], [1.5], [4, , 6]];
for (let round = 0; round < 20; round++) {
    const said = [f0(l0, others[round & 3], round % 3 ? [] : [0.5]), f1(l1, others[round & 3], round % 3 ? [] : [0.5]), f2(l2, others[round & 3], round % 3 ? [] : [0.5]), f3(l3, others[round & 3], round % 3 ? [] : [0.5]), f4(l4, others[round & 3], round % 3 ? [] : [0.5]), f5(l5, others[round & 3], round % 3 ? [] : [0.5]), f6(l6, others[round & 3], round % 3 ? [] : [0.5]), f7(l7, others[round & 3], round % 3 ? [] : [0.5])].map(v => { const t = show(v); return t.length > 120 ? t.length + t.slice(0, 90) : t; });
    if (round < 5 || round > 17) console.log(round, said.join("\n"));
    if (round === 9) { l0.push("z"); l1.push(9); l2.push(undefined); l3.push("z"); l4.push(undefined); l5.push(9); l6.push("z"); l7.push("z"); }
}
