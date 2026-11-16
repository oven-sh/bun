// A key that is the sum of a counter, a number read out of a list or a view, and written numbers.
const starts: (number | undefined)[] = [0, 2, 5, -3, 1.5, undefined, 2147483647, -2147483648, 4294967296, NaN];
const words = new Int32Array([0, 2, 5, -3]);
let view = new Uint8Array(16);
let list: number[] = [];
for (let i = 0; i < 16; i++) {
  view[i] = i * 11;
  list.push(i / 2);
}
const said: string[] = [];
function say(run: () => unknown): void {
  try {
    said.push(String(run()));
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
}
function down(id: number, n: number): number {
  const start = starts[id]!;
  let sum = 0;
  for (let i = n; i > 0; i--) sum += view[start + i - 1]!;
  return sum;
}
function downWord(id: number, n: number): number {
  const start = words[id]!;
  let sum = 0;
  for (let i = n; i > 0; i--) sum += list[start + i - 1]!;
  return sum;
}
function up(id: number, n: number): number {
  const start = starts[id]!;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += list[start + i + 1]! - list[i + 2 + start]!;
  return sum;
}
function beside(id: number, other: number, n: number): string {
  const start = starts[id]!, from = words[other]!;
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += view[1 + start + i - from - 2]!;
    view[i + 3 - 2] = sum;
  }
  return sum + " " + view.join();
}
function store(id: number, n: number): string {
  const start = starts[id]!;
  for (let i = 0; i < n; i++) list[start + i - 1 + 1] = i;
  return list.join() + " " + list.length + " " + Object.keys(list).length;
}
for (let id = -1; id < starts.length; id++) {
  for (const n of [0, 1, 4, 20]) {
    say(() => down(id, n));
    say(() => downWord(id, n));
    say(() => up(id, n));
    say(() => beside(id, id & 3, n));
  }
}
for (const id of [0, 2, 1, 4, 3, 5]) say(() => store(id, 4));
view = new Uint8Array(3);
list = [];
for (let id = 0; id < 4; id++) say(() => down(id, 5) + " " + up(id, 3) + " " + downWord(id, 2));
console.log(said.join("\n"));
