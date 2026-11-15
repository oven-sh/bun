// An index is a sum with a field that holds integers of any size: below zero, past the view, past 2^31, undefined in the middle of the list, a fraction, a text.
const lines: string[] = [];
const view = new Uint16Array(20);
for (let i = 0; i < 20; i++) view[i] = i * 77;
const list: number[] = Array.from({ length: 20 }, (_, i) => i * 13);
type Row = { dy: number; mask: number };
const rowsOf = (entries: [number, number][]): Row[] => [...new Map<number, number>(entries)].map(([dy, mask]) => ({ dy, mask }));
function fits(rows: Row[], y: number): boolean {
  for (const { dy, mask } of rows) {
    const yy = y + dy;
    if (yy >= 20) return false;
    if (yy >= 0 && view[yy]! & mask) return false;
  }
  return true;
}
function sums(rows: Row[], y: number): string {
  let sum = 0,
    missing = 0,
    text = "";
  for (const row of rows) {
    const at = row.dy - y;
    const element = list[at + 3];
    if (element === undefined) missing++;
    else sum += element;
    text += at + ",";
  }
  return sum + " " + missing + " " + text;
}
function counted(rows: Row[], y: number): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    count++;
    if (view[y + rows[i]!.dy]! & rows[i]!.mask) count += 10;
  }
  return count;
}
const all = [
  rowsOf([[0, 3], [1, 6], [2, 1]]),
  rowsOf([[-1, 3], [19, 6], [20, 1], [-20, 9]]),
  rowsOf([[2147483647, 3], [-2147483648, 6], [4294967295, 1], [9007199254740991, 2], [1, 4]]),
];
for (let turn = 0; turn < 4; turn++) {
  for (const rows of all) {
    for (const y of [-2, 0, 1, 5, 19, 20]) lines.push(String(fits(rows, y)), sums(rows, y), String(counted(rows, y)));
  }
  if (turn === 1) (all[0]![1] as any).dy = undefined;
  if (turn === 2) all[1]![2]!.dy = 0.5;
}
console.log(lines.join("\n"));
