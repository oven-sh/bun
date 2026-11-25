const said: string[] = [];
type Row = { rank: number };
const ranks = [5, 3, 8, 1, 7, 2, 6, 4, 9, 0, 12, 11];
function rows(): Row[] { return ranks.map(rank => ({ rank })); }
function show(list: Row[]): string { return list.map(row => row === undefined ? "-" : row.rank).join(","); }
for (let turn = 0; turn < 40; turn++) {
  said.length = 0;
  said.push(show(rows().sort((a, b) => (a.rank < b.rank) as unknown as number)));
  said.push(show(rows().sort((a, b) => (a.rank > b.rank) as unknown as number)));
  said.push(show(rows().sort((a, b) => String(a.rank - b.rank) as unknown as number)));
  try { said.push(show(rows().sort((a, b) => BigInt(a.rank - b.rank) as unknown as number))); } catch (e) { said.push((e as Error).name); }
  said.push(show(rows().sort((a, b) => ({ valueOf() { return a.rank - b.rank; } }) as unknown as number)));
  said.push(show(rows().sort(() => NaN)), show(rows().sort(() => undefined as unknown as number)), show(rows().sort(() => -0)), show(rows().sort(() => null as unknown as number)));
  try { let calls = 0; rows().sort((a, b) => { if (++calls === 9) throw new RangeError("ninth"); return a.rank - b.rank; }); } catch (e) { said.push((e as Error).message); }
  try { rows().sort((a, b) => Symbol("no") as unknown as number); } catch (e) { said.push((e as Error).name); }
  const shrinks = rows(); said.push(show(shrinks.sort((a, b) => { shrinks.length = 3; return a.rank - b.rank; })) + " " + shrinks.length);
  const grows = rows(); said.push(show(grows.sort((a, b) => { if (grows.length < 15) grows.push({ rank: 99 }); return a.rank - b.rank; })) + " " + grows.length);
  const swaps = rows(); said.push(show(swaps.sort((a, b) => { swaps[0] = { rank: -1 }; return b.rank - a.rank; })));
  const frozen = Object.freeze(rows()); try { (frozen as Row[]).sort((a, b) => a.rank - b.rank); } catch (e) { said.push((e as Error).name); }
  const holed = rows(); delete (holed as any)[4]; holed[7] = undefined as unknown as Row; said.push(show(holed.sort((a, b) => a.rank - b.rank)) + " " + (4 in holed) + " " + (11 in holed));
}
console.log(said.join("\n"));
