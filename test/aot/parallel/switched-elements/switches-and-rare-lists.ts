// Switches over elements of lists of numbers, and lists that only some turns read: whole numbers, fractions, holes, texts and lists that are not there.
function shown(x: any): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

const switched = (list: number[]): string => { let total = 0; for (let i = 0; i < list.length; i++) { switch (list[i]) { case 1: total++; break; case 2: total += 3; break; case 3: total += 5; break; case undefined: total += 100; break; default: total += 1000; } } return shown(total); };
const kept = (list: number[]): string => { let total: any = 0; for (let i = 0; i < list.length; i++) { const code = list[i]!; switch (code) { case 0: total++; break; case 1: total += 2; break; case 2.5: total += 7; break; default: total += code; } } return shown(total); };
const machine = (list: number[]): string => { let at = 0, held = 0, steps = 0; while (steps++ < 60) { switch (list[at++]) { case 0: held += 1; break; case 1: held = (held * 3) | 0; break; case 2: held ^= steps; break; case 3: if (held & 1) at++; break; case 4: held -= 7; break; default: held += 2; } if (at >= list.length) at = 0; } return shown(held); };
const weighed = (list: number[], weights: number[], row: number[]): string => { for (let w = 0; w < 12; w++) { const cost = list[w % (list.length || 1)]! & 3; if (w >= cost && row[w - cost]! + weights[w & 3]! > row[w]!) row[w] = row[w - cost]! + weights[w & 3]!; } return row.map(shown).join(); };
const optional = (list: number[], weights?: number[]): string => { let total: any = 0; for (let i = 0; i < list.length; i++) total += weights ? list[i]! * weights[i]! : list[i]!; return shown(total); };
const rare = (list: number[], weights: number[]): string => { let total: any = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (x > 4) total += weights[i & 3]!; total += x; } return shown(total); };

const lists = (): any[] => [[3, 1, 4, 1, 5, 9, 2, 6], [2.5, -0, 0.5, 2.5, 7], [1, , 3, 4], ["1", 1, {}, 2], [], [2], Array.from({ length: 24 }, (_, k) => (k * 7) % 6), Array.from({ length: 24 }, (_, k) => k / 2), [undefined, 1, null, 2], [0, 4294967296, -1, 2147483648], [NaN, 1]];
for (let l = 0; l < lists().length; l++) {
  const tried = (f: () => string): string => { try { return f(); } catch (error) { return `threw ${(error as Error).constructor.name}`; } };
  for (const f of [switched, kept, machine]) console.log(l, tried(() => f(veil(lists()[l]))));
  for (const weights of [[1, 2, 3, 4], [0.5, 1.5, , 2], ["w", 1, 2, 3], undefined, null]) {
    const given = veil(weights);
    console.log(l, tried(() => weighed(veil(lists()[l]), given, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), tried(() => optional(veil(lists()[l]), given)), tried(() => rare(veil(lists()[l]), given)));
  }
}
