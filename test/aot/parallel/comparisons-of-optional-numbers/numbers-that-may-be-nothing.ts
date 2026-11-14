// Numbers that may be undefined or null, off lists, views, fields and calls: compared with each other, with written numbers, and taken for their bits.
declare const process: { readonly argv: readonly string[] };
export {};
interface Cell { a?: number; b?: number | null }
const turns = process.argv.length + 6;
const ints = [3, 1, 2, 0, -1, 7], doubles = [3.5, 1.25, -0, 0, NaN, Infinity], mixed = [3, 1.5, -0, 2147483647, -2147483648, 4294967295];
const nulls: (number | null)[] = [3, null, 2.5, null, 0, -1], holes: (number | undefined)[] = [3, , 2, , 1.5, undefined];
const bytes = new Uint8Array([3, 1, 2, 0, 255, 7]);
const words = new BigUint64Array([0x7ff8000000000001n, 0xfff8000000000000n, 0x7ffc000000000000n, 0x7ffd000000000000n, 0x3ff0000000000000n, 0x7ff4000000000000n]);
const floats = new Float64Array(words.buffer);
const cells: Cell[] = [{ a: 3, b: 1 }, { a: 1.5, b: null }, {}, { a: undefined, b: 0 }, { a: -0, b: -0 }];
const give = (turn: number): number | undefined => { if (turn % 2 === 0) return turn / 4; };
const compare = (x: number | undefined, y: number | undefined): string => (x! < y! ? "less" : x! > y! ? "more" : x! <= y! ? "same" : x! >= y! ? "same?" : "none");
const compareNull = (x: number | null, y: number | null): string => (x! < y! ? "less" : x! > y! ? "more" : x! <= y! ? "same" : "none");
const bits = (x: number | undefined, y: number | undefined): string => [x! | y!, x! & y!, x! ^ 5, x! << 3, x! >> 1, x! >>> 1, ~x!].join();
for (let i = 0; i < turns; i++) {
  const line: string[] = [];
  for (let j = 0; j < 7; j++) {
    line.push(compare(ints[i], ints[j]), compare(doubles[i], mixed[j]), compare(holes[i], doubles[j]), compare(bytes[i], floats[j]), compare(floats[i], ints[j]), compare(cells[i]?.a, cells[j]?.a), compare(give(i), give(j)));
    line.push(compareNull(nulls[i]!, nulls[j]!), compareNull(cells[i]?.b!, cells[j]?.b!), bits(holes[i], mixed[j]), bits(floats[i], ints[j]), bits(give(i), cells[j]?.a));
  }
  console.log(line.join(" "));
}
// The least so far, which may be nothing: the loop of a solver.
function least(list: (number | undefined)[], limit: number): string {
  let best = -1, fewest: number | undefined = 10, found = 0;
  for (let i = 0; i < limit; i++) {
    const options = list[i];
    if (options! < fewest!) { fewest = options; best = i; if (options! <= 1) break; }
    if (options! >= 2 || !options) found++;
  }
  return `${best} ${fewest} ${found}`;
}
for (const list of [ints, doubles, mixed, holes, [...bytes], [...floats]]) for (let limit = 0; limit < 9; limit++) console.log(limit, least(list, limit));
// What was compared is kept, written down and read again: the bits of a number that is none are nobody's.
const kept: unknown[] = [], lists: (number | undefined)[][] = [doubles, holes, [...floats]];
for (const list of lists) for (let i = 0; i < 7; i++) { const value = list[i]; kept.push(value! < 2 ? value : value! > 2 ? [value] : { value }); }
console.log(JSON.stringify(kept), kept.map(entry => typeof entry).join(), Math.max(...ints) < doubles[9]!, [undefined, NaN, null].map(entry => String(entry! < 1)).join());
