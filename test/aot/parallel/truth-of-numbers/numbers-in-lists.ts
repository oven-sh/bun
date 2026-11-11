// Whether a number in a list is truthy: lists of whole numbers, of doubles, with holes, that change their kind, asked in loops and past their end.
declare const process: { readonly argv: readonly string[] };
export {};
const turns = process.argv.length;
const lists: () => (number | undefined)[][] = () => [
  [3, 0, 2, 0, -1, 7], [0, 0, 0], [3.5, 0, -0, 0.25, NaN, Infinity], [1, 0, -0, 0.5, NaN, 2147483647, 4294967295], [1, , 0, , 5], [1.5, , 0, , -0, 5.5], [1, undefined, 0, 2], [],
  Array.from({ length: 6 }, (_, index) => index % 3), new Array(6).fill(0), new Array(6), Object.freeze([1, 0, 2, 0]) as number[],
];
class Board {
  readonly cells: number[] = [];
  readonly weights: number[] = [];
  constructor(size: number) { for (let i = 0; i < size; i++) { this.cells[i] = 0; this.weights[i] = i % 4 ? i / 4 : 0; } }
  free(): number { let n = 0; for (let i = 0; i < 24; i++) { if (this.cells[i]) continue; n += i; } return n; }
  heavy(): number { let n = 0; for (let i = 0; i < 24; i++) if (this.weights[i] && !this.cells[i]) n += this.weights[i]!; return n; }
  past(): number { let n = 0; for (let i = 0; i < 40; i++) if (!this.cells[i]) n++; return n; }
}
const board = new Board(24);
for (let turn = 0; turn < 10 * turns; turn++) { board.cells[(turn * 7) % 24] = turn % 5; if (turn === 12) board.cells[3] = 0.5; console.log(board.free(), board.heavy(), board.past()); }
function count(list: readonly (number | undefined)[], from: number, to: number): string {
  let yes = 0, no = 0, sum = 0;
  for (let i = from; i < to; i++) { if (list[i]) yes++; else no++; }
  for (let i = 0; i < list.length; i++) { const value = list[i]; if (!value) continue; sum += value; }
  for (let i = 0; i < list.length; i++) sum += list[i] && list[i + 1] ? 100 : list[i] || list[i + 1] ? 10 : 1;
  let at = 0;
  while (list[at]) at++;
  return `${yes} ${no} ${sum} ${at}`;
}
for (const list of lists()) console.log(count(list, 0, list.length), count(list, 0, 9), count(list, -2, 3), list.map(value => (value ? "t" : "f")).join(""));
// The list changes its kind while the loop runs.
for (const list of lists()) {
  if (Object.isFrozen(list)) continue;
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) { seen.push(list[i] ? "t" : "f"); if (i === 2) list[4] = 0.5; if (i === 4) (list as unknown[])[5] = "text"; if (i === 5) list.length = 6; }
  console.log(seen.join(""), list.length);
}
// A sieve.
const composite: number[] = new Array(200).fill(0), primes: number[] = [];
for (let i = 2; i < 200; i++) { if (composite[i]) continue; primes.push(i); for (let j = i * i; j < 200; j += i) composite[j] = 1; }
console.log(primes.length, primes.join());
