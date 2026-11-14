// A literal that a loop fills up to and including its bound, or whose length the loop reads, grows once, to the length that it has when the loop ends.
// STATISTIC: CapacitiesReservedFromSourceArrays >= 3
function row(given, count, first) {
    const most = count | 0, kept = [first];
    for (let j = 1; j <= most; j++) { let least = given[j] + 1; const beside = kept[j - 1] + 2; if (beside < least) least = beside; kept[j] = least; }
    return kept;
}
function seen(n, t) { const a = [t]; let s = 0; for (let i = 1; i < n; i++) { s += a.length; a[i] = i * 0.5 + t; s += a.length; } return s + a[a.length - 1]; }
function upTo(n, t) { const a = [t]; for (let i = 1; i <= n; i++) a[i] = a[i - 1] + i * 0.5; return a; }
function stops(given, n, t) { const a = [t]; for (let i = 1; i <= n; i++) { if (given[i] === 9) throw new RangeError("nine"); a[i] = given[i] * 0.5; } return a; }
function leaves(n, t, stop) { const a = [t]; for (let i = 1; i <= n; i++) { if (i === stop) break; a[i] = i * t; } return a; }
const say = v => Array.isArray(v) ? v.length + "[" + v.slice(-4).join() + "]" : String(v);
const given = new Float64Array(200).fill(100), short = new Float64Array([4, 3, 2, 1]), boxed = Array.from({ length: 150 }, (_, i) => i === 60 ? 9 : i);
for (let turn = 0; turn < 3; turn++) {
    for (const n of [0, 1, 2, 24, 25, 26, 27, 41, 66, 100, 150]) {
        console.log(n, say(row(given, n, 1)), say(row(given, n, 0.5)), say(row(short, n, 2)), say(row(boxed, n, 1)), say(seen(n, 1)), say(seen(n, 0.25)), say(upTo(n, 1)), say(upTo(n, 0.5)), say(leaves(n, 0.5, 30)));
        try { console.log(say(stops(boxed, n, 1))); } catch (e) { console.log(e.message); }
    }
}
