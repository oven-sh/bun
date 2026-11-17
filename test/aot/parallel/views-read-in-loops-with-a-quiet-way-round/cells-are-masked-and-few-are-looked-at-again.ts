type Patch = { x: number; y: number; width: number; height: number };
type Board = { width: number; height: number; words: Int32Array; patch: Patch | undefined };
const MASK = 3;
const out: string[] = [];
function setAt(board: Board, x: number, y: number, name: number, span: number): void {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return;
  const at = (y * board.width + x) << 1;
  board.words[at] = name; board.words[at + 1] = (name << 17) | span;
}
function shrink(board: Board): void { board.words = board.words.subarray(0, board.words.length >> 1); }
function markWide(board: Board, deed: (board: Board) => void): number {
  const patch = board.patch; if (!patch) return 0;
  let found = 0;
  const lastX = Math.min(board.width - 2, patch.x + patch.width - 1), lastY = Math.min(board.height, patch.y + patch.height);
  for (let y = patch.y; y < lastY; y++) {
    for (let x = patch.x; x <= lastX; x++) {
      const word = board.words[((y * board.width + x) << 1) + 1]!;
      if ((word & MASK) !== 1) continue;
      found += board.words[(y * board.width + x) << 1]! + (board.words[((y * board.width + x) << 1) + 3] ?? -1000);
      if (found % 7 === 0) deed(board);
    }
  }
  return found;
}
const make = (): Board => { const board: Board = { width: 40, height: 12, words: new Int32Array(40 * 12 * 2), patch: { x: 0, y: 0, width: 40, height: 12 } }; for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) setAt(board, x, y, (x * 3 + y) % 11, x % 9 === 4 ? 1 : 0); return board; };
const quiet = make(); for (let turn = 0; turn < 50; turn++) out.push(String(markWide(quiet, () => {})));
const cut = make(); out.push(String(markWide(cut, shrink)), String(cut.words.length), String(markWide(cut, shrink)), String(cut.words.length));
const gone = make(); out.push(String(markWide(gone, (board) => { structuredClone(board.words.buffer, { transfer: [board.words.buffer] }); })), String(gone.words.length));
console.log(out.slice(0, 2).join(), out.slice(50).join());
