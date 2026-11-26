// Some calls leave the limit out: undefined is carried beside the numbers that come round.
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : String(v));
function upTo(list, limit) { let last; for (let i = 0; i < list.length; i++) { if (limit !== undefined && i >= limit) break; last = list[i]; limit = limit === undefined ? last : limit; } return show(last) + show(limit); }
function lowest(list, start) { let low = start, at = start; for (let i = 0; i < list.length; i++) { if (low === undefined || list[i] < low) { low = list[i]; at = i; } } return show(low) + "@" + show(at); }
function steps(n, by) { let at = by, out = ""; while (n-- > 0) { out += show(at); at = at === undefined ? n : at + 1; } return out; }
const lists = [[3, 1, 2], [], [0.5, -0, 7], [5, , 2], ["a", 1], [undefined, 4], new Int32Array([9, 8, 7])]; lists[0].label = "named"; lists[4].extra = 1;
for (const list of lists) console.log(upTo(list), upTo(list, 2), upTo(list, undefined), upTo(list, 1.5), lowest(list), lowest(list, 2), lowest(list, NaN), show(list.label), Object.keys(list).length);
for (const by of [undefined, 0, 2, -1, 0.5, 2 ** 31 - 2, NaN, "1", null]) console.log(steps(0, by), steps(4, by)); console.log(steps(3), upTo([1, 2, 3], "2"), lowest([4, 3], null), lowest([1n, 2n]));
for (let k = 0; k < 100; k++) { upTo(lists[0], k & 1 ? k : undefined); lowest(lists[2], k & 1 ? undefined : k); if (k & 1) steps(k & 7); else steps(k & 7, k); }
