function carry(view: Int16Array, from: number, to: number, by: number): number {
  let moved = 0;
  for (let at = from; at < to; at++) {
    const held = view[at];
    view[at + by] = held + by;
    moved += held;
  }
  return moved;
}
function rotate(view: Uint8Array, first: number, count: number): void {
  const kept = view[first];
  for (let at = first; at < first + count; at++) view[at] = view[at + 1];
  view[first + count] = kept;
}
const shown = (view: ArrayLike<number>): string => Array.from(view).join();
for (const [from, to, by] of [[0, 6, 1], [2, 6, 3], [4, 10, 1], [-2, 3, 2], [0, 4, -2], [6, 9, 9]]) {
  const view = Int16Array.from({ length: 8 }, (_, at) => at * 5000);
  console.log(from, to, by, carry(view, from, to, by), shown(view));
}
for (const [first, count] of [[0, 4], [3, 4], [5, 6], [7, 1], [-1, 3], [8, 2]]) {
  const view = Uint8Array.from({ length: 8 }, (_, at) => at * 40);
  rotate(view, first, count);
  console.log(first, count, shown(view), String((view as any)[-1]));
}
let sum = 0;
for (let round = 0; round < 50; round++) {
  const view = new Int16Array(16).fill(round);
  sum += carry(view, round % 5, 12, round % 4);
  const bytes = new Uint8Array(16).map((_, at) => at * round);
  rotate(bytes, round % 9, 5);
  sum += view[12] + bytes[7];
}
console.log(sum);
const odd: any[] = ["3", null, undefined, true, 0.75, NaN, 70000, { valueOf: () => 9 }];
const taken = new Int16Array(odd.length);
for (let at = 0; at < odd.length; at++) taken[at] = odd[at];
console.log(shown(taken), carry(odd as any, 0, 3, 4), odd.map(String).join());
try {
  (taken as any)[0] = 4n;
} catch (error) {
  console.log((error as Error).constructor.name, shown(taken));
}
