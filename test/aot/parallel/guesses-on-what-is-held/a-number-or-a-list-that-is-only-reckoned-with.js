// A table holds numbers and one list and is read under a key that is computed; what is read is kept in a second table and handed on.
// One function only reckons with it and compares it; another calls push off it. Numbers, the list and nothing at all arrive: every answer is plain Bun's.
const places = { a1: 5, b2: 12, c3: 19, d4: [1, 2, 3] };
const offsets = { n: [7, 9, 11], k: [1, 8, 13] };
function reaches(place, from, kind) { let hits = 0; for (let k = 0; k < offsets[kind].length; k++) { for (let s = from + offsets[kind][k]; !(s & 0x88); s += offsets[kind][k]) { if (s === place) hits++; } } return hits + (place - from > 0 ? 100 : 0); }
function fills(list, from, kind) { let hits = 0; for (let k = 0; k < offsets[kind].length; k++) { for (let s = from + offsets[kind][k]; !(s & 0x88); s += offsets[kind][k]) { if (s === 40) list.push(s); hits++; } } return hits + " " + list.length; }
const kept = { w: -1, b: -1 };
function keep(side, i) { kept["wb".charAt(side)] = places["abcd".charAt(i) + (i + 1)]; }
function at(i, turn) { keep(turn & 1, i); return reaches(kept["wb".charAt(turn & 1)], turn, "nk".charAt(turn & 1)); }
for (let turn = 0; turn < 3; turn++) for (let i = 0; i < 4; i++) console.log(at(i, turn));
console.log(at(7, 0));
console.log(at(3, 5));
keep(0, 3);
console.log(fills(kept["wb".charAt(0)], 0, "nk".charAt(1)));
console.log(places.d4.join());
console.log("end");
