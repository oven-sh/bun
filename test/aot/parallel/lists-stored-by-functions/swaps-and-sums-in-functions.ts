// Loops that hand their lists to small functions which read and store: swaps, sums in place, stores of handed numbers, grids, a whole quick sort; lists of every storage, and numbers that are none.
function shown(x: any): string { return Array.isArray(x) || x instanceof Float64Array ? `[${x.length}:${Array.from({ length: x.length }, (_, i) => (i in x ? shown(x[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

function swap(list: number[], i: number, k: number): void { const kept = list[i]!; list[i] = list[k]!; list[k] = kept; }
function swapPattern(list: number[], i: number, k: number): void { [list[i], list[k]] = [list[k]!, list[i]!]; }
function add(list: number[], i: number, x: number): void { list[i]! += x; }
function put(list: number[], i: number, x: number): void { list[i] = x; }
function cell(list: number[], width: number, x: number, y: number): number { return list[y * width + x]!; }
function putCell(list: number[], width: number, x: number, y: number, value: number): void { list[y * width + x] = value; }
function scaled(list: number[], other: number[], i: number): void { other[i] = list[i]! * 0.5 + other[i]!; }
function grow(list: number[], x: number): void { list[list.length] = x; }

const reversed = (list: number[]): string => { for (let i = 0, k = list.length - 1; i < k; i++, k--) swap(list, i, k); return shown(list); };
const reversedByPattern = (list: number[]): string => { for (let i = 0, k = list.length - 1; i < k; i++, k--) swapPattern(list, i, k); return shown(list); };
const raised = (list: number[]): string => { for (let i = 0; i < list.length; i++) add(list, i, i % 3 === 2 ? 0.5 : 1); return shown(list); };
const filled = (list: number[], odd: any): string => { for (let i = 0; i < list.length; i++) put(list, i, i === 3 ? odd : i * 2); return shown(list); };
const turned = (list: number[]): string => { const other = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) putCell(other, 3, y, x, cell(list, 3, x, y)); return shown(other); };
const added = (list: number[]): string => { for (let i = 0; i < list.length; i++) scaled(list, list, i); return shown(list); };
const grown = (list: number[]): string => { for (let i = 0; i < 4; i++) { add(list, i, 1); if (list.length < 40) grow(list, i / 2); } return shown(list); };
function sort(list: number[], from: number, to: number): void {
  if (from >= to) return;
  const pivot = list[(from + to) >> 1]!;
  let i = from, k = to;
  while (i <= k) {
    while (list[i]! < pivot) i++;
    while (list[k]! > pivot) k--;
    if (i <= k) { swap(list, i, k); i++; k--; }
  }
  sort(list, from, k);
  sort(list, i, to);
}
const sorted = (list: number[]): string => { sort(list, 0, list.length - 1); return shown(list); };

const lists = (): any[] => [[3, 1, 4, 1, 5, 9, 2, 6, 5], [2.5, -0, 0.5, 7, 1e300, -3, 4, 8, 0.25], [1, , 3, 4], ["a", 1, {}, 2], [], [7], Array.from({ length: 24 }, (_, k) => (k * 7) % 11), Array.from({ length: 24 }, (_, k) => k / 4 - 3), [undefined, 1, null, 2], Object.freeze([4, 5, 6]), new Float64Array([1.5, 2, 3])];
for (let l = 0; l < lists().length; l++) {
  for (const f of [reversed, reversedByPattern, raised, turned, added, grown, sorted]) {
    const list = veil(lists()[l]);
    let answer: string;
    try { answer = f(list); } catch (error) { answer = `threw ${(error as Error).constructor.name} ${shown(list)}`; }
    console.log(l, answer);
  }
  for (const odd of [1.5, "t", undefined, 2n, { valueOf() { return 4; } }]) {
    const list = veil(lists()[l]);
    let answer: string;
    try { answer = filled(list, veil(odd)); } catch (error) { answer = `threw ${(error as Error).constructor.name} ${shown(list)}`; }
    console.log(l, answer);
  }
}
