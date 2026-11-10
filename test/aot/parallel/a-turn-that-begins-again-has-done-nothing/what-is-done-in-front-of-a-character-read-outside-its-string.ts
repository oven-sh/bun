// STATISTIC: TurnsThatBeginAgain >= 1
// A character read outside its string leaves the typed turn of a loop and the turn begins again in the other copy. Whatever the turn did in front of the read would then be done twice.
let bumps = 0, noted = 0;
const pushed: number[] = [], counts = new Map<string, number>(), box = { stores: 0 };
function nothing(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function bump(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { bumps++; const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function push(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { pushed.push(i); const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function count(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { counts.set("k", (counts.get("k") ?? 0) + 1); const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function store(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { box.stores += 1; const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function view(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { row[7] = row[7]! + 1; const c = s.charCodeAt(i); row[i & 3] = c === c ? c : 1000; total += row[i & 3]! + row[7]!; } return total; }
function note(x: number): void { noted = (noted * 3 + x) | 0; }
function called(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { note(i); const c = s.charCodeAt(i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function unit(s: string, i: number): number { return s.charCodeAt(i); }
function callee(s: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { const c = unit(s, i); row[i & 7] = c === c ? c : 1000; total += row[i & 7]!; } return total; }
function peek(s: string, row: Uint32Array): number { let i = 0, seen = 0; while (s.charCodeAt(i++) === 97) { row[seen & 7] = i; seen++; } return seen * 10 + i + row[0]!; }
function two(s: string, t: string, row: Uint32Array, turns: number): number { let total = 0; for (let i = 0; i < turns; i++) { const c = s.charCodeAt(i); bumps++; const d = t.charCodeAt(i); row[i & 7] = c === d ? 1 : c === c ? 2 : d === d ? 3 : 4; total += row[i & 7]!; } return total; }
for (const text of ["", "a", "aab", "aaaaaaaaaaaaaaaaaaaaaaaaab", "aa b", "a".repeat(70)]) for (const turns of [0, 1, 3, 5, 26, 27, 71, 140]) {
  bumps = 0; noted = 0; pushed.length = 0; counts.clear(); box.stores = 0;
  const row = new Uint32Array(8);
  console.log(text.length, turns, nothing(text, row, turns), bump(text, row, turns), bumps, push(text, row, turns), pushed.length, count(text, row, turns), counts.get("k"), store(text, row, turns), box.stores, view(text, row, turns), called(text, row, turns), noted, callee(text, row, turns), peek(text, row), two(text, "aab", row, turns), bumps, row.join());
}
