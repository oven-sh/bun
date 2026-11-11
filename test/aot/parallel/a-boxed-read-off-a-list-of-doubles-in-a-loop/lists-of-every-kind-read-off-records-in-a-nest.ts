// STATISTIC: BoxedReadsWithDoublePath >= 1
// A list of numbers that is read off a record in the turn of a loop is of no kind that was asked in front: its elements are read boxed. In a loop such a read has an arm in line for storage of doubles too.
interface Line { readonly cells: number[] }
function show(x: unknown): string { return typeof x === "number" && Object.is(x, -0) ? "-0" : String(x); }
function gather(lines: Line[], upTo: number): string { let text = ""; for (const { cells } of lines) { for (let i = 0; i < upTo; i++) { const c = cells[i]; text += show(c) + ","; } text += ";"; } return text; }
function each(lines: Line[]): string { let text = "", sum = 0; for (const { cells } of lines) { for (const c of cells) { sum += c; text += show(c) + ","; } text += ";"; } return text + show(sum); }
function index(lines: Line[], grid: number[]): string { let mine = 0, theirs = 0; for (const { cells } of lines) for (const c of cells) { const at = grid[c]; if (at === 1) mine++; else if (at !== 0) theirs++; } return mine + " " + theirs; }
function under(lines: Line[], keys: number[]): string { let text = ""; for (const { cells } of lines) for (const k of keys) text += show(cells[k]) + ","; return text; }
const holed: number[] = [0.5, 1.5, 2.5, 3.5]; delete holed[2];
const grown: number[] = [0.5]; grown[3] = 4.5;
const turned: any[] = [0.5, 1.5]; turned.push("text");
const whole = [0, 1, 2, 3].map(k => (1 + 1 * k) * 7 + 2 + 0 * k);
const halves = [0, 1, 2, 3].map(k => k / 2);
const made: Line[] = [
  { cells: [0.5, 1.5, 2.5, 3.5] }, { cells: [1, 2, 3, 4] }, { cells: whole }, { cells: halves }, { cells: holed }, { cells: grown }, { cells: turned as number[] }, { cells: [] },
  { cells: [NaN, -0, Infinity, -Infinity, 1e300, 5e-324] }, { cells: Object.freeze([0.25, 0.75]) as number[] }, { cells: new Array<number>(3) }, { cells: new Array<number>(3).fill(0.5) }, { cells: [2 ** 31, -(2 ** 31) - 1, 2 ** 53] },
];
const grid: number[] = new Array<number>(42).fill(0); for (let i = 0; i < 42; i += 3) grid[i] = 1 + (i & 1);
for (const upTo of [0, 1, 4, 5, 7]) console.log(gather(made, upTo));
console.log(each(made));
console.log(index(made, grid), index([{ cells: whole }, { cells: halves }, { cells: [41, 42, -1, 0.5] }], grid));
console.log(under(made, [0, 1, 3, 4, -1, 0.5, 1.0, NaN, 4294967295, 4294967296]));
made[0]!.cells.push(4.5); made[1]!.cells.push(0.5); made[3]!.cells.length = 1;
console.log(gather(made, 6)); console.log(each(made));
