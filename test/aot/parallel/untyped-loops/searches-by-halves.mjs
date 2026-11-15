// Searches by halves over lists of int32s, doubles, both, holes and boxed values, called out of loops of functions and of the module; lists whose kind changes between two searches and inside one.
function f0(a, x) { let lo = 0, hi = a.length, guard = 0; while (lo < hi) { const m = (lo + hi) >>> 1; steps += a[m]; const d = a[m] - x; if (d < 0) lo = m + 1; else if (d > 0) hi = m; else return m; } return -lo; }
function d0(a, c) { let n = 0; for (let k = 0; k < c; k++) { if (k === 10) late(a, 0); n = (n * 31 + f0(a, (k * 7) % 40)) | 0; } return n; }
function f1(a, x) { let lo = 0, hi = a.length, guard = 0; while (guard++ < 40 && (lo <= hi)) { const m = lo + ((hi - lo) >> 1); const v = a[m];  if (v < x) lo = m + 1; else if (v > x) hi = m - 1; else return m; } return ~lo; }
function d1(a, c) { let n = 0; for (let k = 0; k < c; k++) { if (k === 2) a[2] = 7; n = (n * 31 + f1(a, (k * 7) % 40 - 3)) | 0; } return n; }
function f2(a, x) { let lo = 0, hi = a.length, guard = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (m === 6) late(a, 1); if (a[m] === x) return m; if (a[m] > x) lo = m + 1; else hi = m - 1; } return -1; }
function d2(a, c) { let n = 0; for (let k = 0; k < c; k++) { if (k === 7) a[3] = 0.5; n = (n * 31 + f2(a, (k * 7) % 40)) | 0; } return n; }
function f3(a, x) { let lo = -1, hi = a.length + 2, guard = 0; while (lo <= hi) { const m = (lo + hi) >> 1; const v = a[m]; steps += a[m]; if (v > x) lo = m + 1; else if (v > x) hi = m - 1; else return m; } return ~lo; }
function d3(a, c) { let n = 0; for (let k = 0; k < c; k++) { if (k === 15) a[1] = NaN; n = (n * 31 + f3(a, k)) | 0; } return n; }
function f4(a, x) { let lo = -1, hi = a.length + 2, guard = 0; while (lo <= hi) { const m = lo + ((hi - lo) >> 1); const v = a[m];  if (v > x) lo = m + 1; else if (v > x) hi = m - 1; else return m; } return ~lo; }
function d4(a, c) { let n = 0; for (let k = 0; k < c; k++) { if (k === 14) late(a, 6); n = (n * 31 + f4(a, k * 0.5)) | 0; } return n; }
function f5(a, x) { let lo = 0, hi = a.length, guard = 0; while (guard++ < 40 && (lo <= hi)) { const m = (lo + hi) >>> 1;  if (a[m] === x) return m; if (a[m] >= x) lo = m + 1; else hi = m - 1; } return -1; }
function d5(a, c) { let n = 0; for (let k = 0; k < c; k++) {  n = (n * 31 + f5(a, (k * 7) % 40 - 3)) | 0; } return n; }
let steps = 0, last;
function late(a, how) {
    if (how === 0) a[2] = 0.25; else if (how === 1) a.push(4.5); else if (how === 2) a.length = Math.max(0, a.length - 3); else if (how === 3) delete a[1];
    else if (how === 4) a[0] = "1"; else if (how === 5) a.sort((x, y) => x - y); else a.splice(1, 2, 2, 3);
}
const own0 = Array.from({ length: 100 }, (_, i) => i * 2 - 7); let sum0 = 0; for (let k = 0; k < 60; k++) { if (k === 17) late(own0, 3); sum0 = (sum0 * 17 + f2(own0, (k * 7) % 50)) | 0; } console.log("own0", sum0, own0.length);
const own1 = Array.from({ length: 100 }, (_, i) => i * 2 - 7); let sum1 = 0; for (let k = 0; k < 60; k++) { if (k === 11) own1[3] = 0.5; sum1 = (sum1 * 17 + f5(own1, (k * 7) % 50)) | 0; } console.log("own1", sum1, own1.length);
const kinds = [
    () => Array.from({ length: 20 }, (_, i) => i * 3), () => Array.from({ length: 20 }, (_, i) => i * 1.5), () => [1, 2, 3, 4.5, 6, 8], () => [], () => [5], () => [1, , 3, 4, , 9], () => [1, 2, undefined, 4, 5],
    () => [1, 2, NaN, 4, 5, 6], () => ["1", "2", "3"], () => [1, "2", 3, null, 5], () => Array.from({ length: 33 }, (_, i) => i - 16), () => [-0, 0, 1, 2 ** 31, 2 ** 32, 2 ** 53], () => JSON.parse("[1,4,9,16,25,36]"),
    () => new Array(8).fill(3), () => [2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1], () => Object.freeze([1, 2, 3, 4]),
];
for (let round = 0; round < 8; round++) for (const [d, f] of [[d0, f0], [d1, f1], [d2, f2], [d3, f3], [d4, f4], [d5, f5]]) kinds.forEach((kind, j) => {
    steps = 0; last = undefined; let answer;
    const a = kind();
    try { answer = d(a, 24); } catch (e) { answer = e.name; }
    if (round === 0 || round === 7) {
        let keys = [];
        for (const x of [3, 4.5, "2", null, undefined, -1, 2 ** 31, 1e9, { valueOf() { return 2; } }]) { try { keys.push(f(kind(), x)); } catch (e) { keys.push(e.name); } }
        console.log(d.name, round, j, answer, Object.is(last, -0) ? "-0" : last, steps, keys.join(","), a.map(String).join(" "));
    }
});
