// Tables of n + c elements, views and arrays, whose loops test their positions against n; counters that begin below zero, bounds and lengths that change in the middle, buffers that are detached or resized.
function f0(b, l, n, s) { let m = l.length; if (!(((m) + 2) >= 0)) return "negative"; const row = new Uint8Array((m) + 2); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = s; k <= m + 1; k++) { out += row[k - 2]; t = row[m]; last = row[k]; row[k] = Math.max(row[k - 2] + 1, row[k] + 1, last + (i === k ? 0 : 1)); if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f1(b, l, n, s) { if (!(((l.length) + 1) >= 0)) return "negative"; const row = new Array((l.length) + 1).fill(null); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= l.length; k++) { row[k - 1] = Math.max(row[k] + 1, row[k - 1] + 1, last + (i === k ? 0 : 1)); last = row[k - 2]; row[k + 1] = t; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f2(b, l, n, s) { let m = b.length; if (!((1 + (m)) >= 0)) return "negative"; const row = new Float64Array(1 + (m)); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= m - 1; ++k) { row[k - 2] = Math.max(row[k] + 1, row[k + 1] + 1, last + (i === k ? 0 : 1)); last = row[k]; out += row[k - 2]; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f3(b, l, n, s) { let m = l.length - 1; if (!(((m) + 1) >= 0)) return "negative"; const row = Array.from({ length: (m) + 1 }, (_, i) => i * 0.5); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= m + 1; ++k) { row[m] = Math.max(row[k + 1] + 1, row[k] + 1, last + (i === k ? 0 : 1)); row[k] = Math.max(row[k - 1] + 1, row[k] + 1, last + (i === k ? 0 : 1)); m--; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f4(b, l, n, s) { if (!(((b.length) + 3) >= 0)) return "negative"; const row = new Uint16Array(new ArrayBuffer(Math.max(0, ((b.length) + 3) * 2), { maxByteLength: 400 })); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 1; k <= b.length + 2; k++) { row[k - 2] = k * 0.5; last = row[k]; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f5(b, l, n, s) { let m = b.length; if (!(((m) + 1) >= 0)) return "negative"; const row = new Int32Array((m) + 1); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= m + 1; k += 2) { row[k - 2] = t; row[k - 2] = t; if (i === 2) change(row, 1); if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f6(b, l, n, s) { if (!(((l.length - 1) + 1) >= 0)) return "negative"; const row = new Uint8Array((l.length - 1) + 1); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= l.length - 1 - 1; k++) { if (row[k] > undefined) { last = row[k]; } row[k + 1] = i; t = row[(l.length - 1) - k]; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f7(b, l, n, s) { let m = b.length; if (!(((m) + 2) >= 0)) return "negative"; const row = Array.from({ length: (m) + 2 }, (_, i) => 0); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = s; k <= m + 2; k++) { row[k] = k * 0.5; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f8(b, l, n, s) { let m = l.length - 1; if (!(((m) - 1) >= 0)) return "negative"; const row = Array.from({ length: (m) - 1 }, (_, i) => i * 0.5); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = s; k < m + 1; k++) { if (k === 1) break; if (row[k - 2] === t) { row[k + 1] = Math.max(row[k] + 1, row[k - 1] + 1, last + (i === k ? 0 : 1)); } row[k] = i + k; row[k] = i; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
function f9(b, l, n, s) { if (!(((n | 0) + 1) >= 0)) return "negative"; const row = new Float32Array((n | 0) + 1); let t = 0, last = 0, out = 0; for (let i = 0; i < 3; i++) { last = row[0]; for (let k = 0; k <= n | 0; ++k) { t = row[(n | 0) - k]; out += row[k]; out += row.length; if (++turns > 4000) return "many"; } } return [out, t, last, show(row)].join("|"); }
let turns = 0, heard = "";
const seen = v => { heard += String(v) + ","; if (heard.length > 4000) heard = heard.length + ";"; };
const show = row => { try { return Array.prototype.map.call(row, v => Object.is(v, -0) ? "-0" : String(v)).join(" "); } catch (e) { return e.name; } };
const change = (row, how) => {
    try {
        if (how === 0 && row.buffer) structuredClone(row.buffer, { transfer: [row.buffer] });
        else if (how === 1 && row.buffer?.resizable) row.buffer.resize(Math.max(0, row.buffer.byteLength - 4));
        else if (how === 2 && Array.isArray(row)) row.length = Math.max(0, row.length - 2);
        else if (how === 3 && Array.isArray(row)) row.push(0.25);
        else if (how === 4 && Array.isArray(row)) row[1] = "text";
        else if (how === 5 && Array.isArray(row)) delete row[2];
    } catch (e) { heard += e.name; }
};
const takes = [["kitten", [1, 2, 3], 4, 0], ["", [], 0, 0], ["a", [1], 1, 1], ["sitting at the mall", [1, 2, 3, 4, 5, 6, 7], 9, 2], ["kitten", [1, 2], 5, 0], ["bb", [0.5, 1], 2.5, 1], ["ccc", [1], -1, 0], ["four", [3, 2, 1, 0], 6, -1]];
for (const f of [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9]) {
    for (let round = 0; round < 12; round++) for (const take of takes) {
        turns = 0; heard = ""; let answer;
        try { answer = f(...take); } catch (e) { answer = e.name + ": " + e.message.slice(0, 40); }
        if (round === 0 || round === 11) console.log(f.name, round, answer, heard);
    }
}
