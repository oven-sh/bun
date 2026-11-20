// A loop reads a view off a field. One test of the view's memory before the loop lets its length leave the loop; a view over shared memory that grows restarts the iteration.
// STATISTIC: ViewMemoryTestsHoisted >= 2
class Board {
  static readonly height = 20;
  rows: Uint16Array;
  constructor(rows: Uint16Array) { this.rows = rows; }
  top(x: number): number { let y = 0; while (y < Board.height && !(this.rows[y] & (1 << x))) y++; return y; }
  sum(): number { let t = 0; for (let i = 0; i < 24; i++) t += this.rows[i] & 7; return t; }
  heights(): number[] { const out: number[] = []; for (let x = 0; x < 6; x++) { let y = 0; while (y < Board.height && !(this.rows[y] & (1 << x))) y++; out.push(Board.height - y); } return out; }
  mark(n: number): number { for (let i = 0; i < n; i++) this.rows[i] |= i & 255; return this.rows[n - 1]; }
  late(grow: (board: Board) => void): number { let t = 0; for (let i = 0; i < 30; i++) { if (i === 10) grow(this); t += this.rows[i] & 15; } return t; }
}
const said: string[] = [];
const growing = new SharedArrayBuffer(16, { maxByteLength: 128 }) as any, resizing = new ArrayBuffer(16, { maxByteLength: 128 } as any) as any;
const boards = [new Uint16Array(20), new Uint16Array(growing), new Uint16Array(resizing), new Uint16Array(new SharedArrayBuffer(16)), new Uint16Array(growing, 2), new Uint16Array(resizing, 0, 2), new Uint16Array(0), new Uint16Array(64)].map(rows => new Board(rows));
for (const board of boards) for (let i = 0; i < board.rows.length; i++) board.rows[i] = (i * 37) & 255;
for (let round = 0; round < 12; round++) {
  if (round === 4) growing.grow(48);
  if (round === 6) resizing.resize(64);
  if (round === 8) resizing.resize(4);
  if (round === 9) growing.grow(128);
  for (const board of boards) {
    let line = "";
    for (let x = 0; x < 8; x++) line += board.top(x) + ",";
    line += board.heights().join() + "/" + board.sum() + "/" + board.late(b => { if (round === 5 && (b.rows.buffer as any) === resizing) resizing.resize(80); if (round === 10 && b === boards[7]) structuredClone(b.rows.buffer, { transfer: [b.rows.buffer as ArrayBuffer] }); if (round === 7 && b === boards[0]) b.rows = new Uint16Array(40).fill(9); });
    if (round % 3 === 2) line += "/" + board.mark(6);
    said.push(line);
  }
}
let hash = 0;
for (const line of said) for (const c of line) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.length);
console.log(said.slice(0, 15).join("\n"));
console.log(said.slice(-30).join("\n"));
