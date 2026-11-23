// STATISTIC: UnrolledLoopsEmitted >= 12
// Loops over a list that lies in a field and was made with a length: what is no number, and a hole, stands at each place in turn; the field is written while the loop runs.
const shown = (x: unknown): string => typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : String(x);
class Board {
  readonly cells: number[] = new Array<number>(20).fill(0);
  list: number[] = new Array<number>(20).fill(3);
  total = 0;
  constructor() { for (let i = 0; i < 20; i++) this.cells[(i * 7) % 20] = (i * 37) % 11 - 2; }
  sum(): number { let t = 0; for (let i = 0; i < this.cells.length; i++) t += this.cells[i]!; return t; }
  first(): number { let t = 0; for (let i = 0; i < 20; i++) t += this.cells[i]!; return t; }
  product(): number { let t = 0; for (let i = 0; i < this.cells.length; i++) t += this.cells[i]! * this.list[i]!; return t; }
  equal(): number { let t = 0; for (let i = 0; i < 20; i++) { const p = this.cells[i]!; if (p === 0) continue; if (p === 3 || p === -2) t++; else t += 100; } return t; }
  most(): number { let t = -Infinity; for (let i = 0; i < this.cells.length; i++) if (this.cells[i]! > t) t = this.cells[i]!; return t; }
  cut(): number { let t = 0; for (let i = 0; i < this.cells.length; i++) t = (t + this.cells[i]!) | 0; return t; }
  kept(): number { for (let i = 0; i < this.cells.length; i++) this.total += this.cells[i]!; const t = this.total; this.total = 0; return t; }
  steps(): number { let t = 0; for (let at = 1; !(at & 32); at += 3) { const p = this.cells[at]!; if (p === 0) continue; if (p === 5) break; t += p; } return t; }
  exchanged(turn: number): number { let t = 0; for (let i = 0; i < this.list.length; i++) { if (i === turn) this.list = [1, 2.5, NaN, 4, 5, 6, 7, 8, 9, 10, 11, 12]; t += this.list[i] ?? 100; } return t; }
  shortened(turn: number): number { let t = 0; const l = this.list; for (let i = 0; i < 14; i++) { if (i === turn) this.list.length = 9; t += this.list[i] ?? 1000; } this.list = l; return t; }
}
const odd: [string, unknown][] = [["none", 4], ["undefined", undefined], ["NaN", NaN], ["a fraction", 2.5], ["minus zero", -0], ["past an int32", 2 ** 40], ["the least int32", -2147483648], ["endless", Infinity], ["null", null], ["a text", "12"], ["true", true], ["an object", { valueOf() { return 12; } }], ["a hole", 0]];
for (const name of ["sum", "first", "product", "equal", "most", "cut", "kept", "steps"] as const) {
  for (const [what, value] of odd) {
    const said: string[] = [];
    for (let at = 0; at < 20; at++) {
      const board = new Board();
      if (what === "a hole") delete board.cells[at]; else (board.cells as unknown[])[at] = value;
      said.push(shown(board[name]()));
    }
    console.log(name, what, said.join(" "));
  }
}
for (let turn = 0; turn < 22; turn++) console.log(turn, shown(new Board().exchanged(turn)), shown(new Board().shortened(turn)));
const frozen = new Board(); Object.freeze(frozen.cells); console.log(frozen.sum(), frozen.equal());
const given = new Board(); Object.defineProperty(given.cells, 4, { get() { return 1000; } }); console.log(given.sum(), given.first(), given.equal());
const far = new Board(); far.cells[100000] = 7; console.log(far.first(), far.equal());
