const member = (wide: boolean, i: number): unknown => (wide ? i * 3 : "m" + i);
function three(it: Iterable<unknown>): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const [a, b, c] = it; return String(a) + "/" + String(b) + "/" + String(c); }
function twoPairs(it: Iterable<unknown>): string { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const [p, q] = it; return String(p) + "/" + String(q); }
function row(wide: boolean, size: number, from: number, length: number): string { const set = new Set<unknown>(), map = new Map<unknown, unknown>();
  for (let i = 0; i < size; i++) { set.add(member(wide, i)); map.set(member(wide, i), i); } for (let i = from; i < from + length && i < size; i++) { set.delete(member(wide, i)); map.delete(member(wide, i)); } return three(set) + " " + twoPairs(map); }
console.log("SAID others " + three([7, 8, 9]) + " " + three("xyz") + " " + twoPairs([[1, 2], [3, 4]]));
for (const wide of [true, false]) for (let from = 0; from < 18; from++) { let line = "SAID " + wide + " " + from + ":"; for (const length of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15, 16, 17, 31, 32, 33, 40]) line += " " + row(wide, 64, from, length); console.log(line); }
for (const wide of [true, false]) console.log("SAID ends " + wide + " " + [row(wide, 30, 0, 30), row(wide, 30, 1, 29), row(wide, 30, 8, 22), row(wide, 31, 1, 29), row(wide, 64, 16, 48), row(wide, 64, 1, 47)].join(" . ")); export {};
