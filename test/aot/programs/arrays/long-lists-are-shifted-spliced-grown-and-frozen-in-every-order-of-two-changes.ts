// Lists long enough that shifting, unshifting, splicing, growing and making them by length give them another form of storage. Each is made and read in one function, so that what holds its elements is known there, and is read again behind every change, in every order of two changes.
const lines: string[] = [];
function digest(list: number[]): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < list.length; i++) {
    const value = list[i];
    if (value === undefined) holes++;
    else sum = (sum + value * (i + 1)) % 1000003;
  }
  return list.length + ":" + sum + ":" + holes;
}
type Change = (list: number[]) => void;
const changes: [string, Change][] = [
  ["shift", list => { list.shift(); }],
  ["unshift", list => { list.unshift(7); }],
  ["splice-out", list => { list.splice(1, 2); }],
  ["splice-in", list => { list.splice(1, 0, 5, 6, 7); }],
  ["grow", list => { list.length = list.length + 70000; }],
  ["far", list => { list[list.length + 20000] = 3; }],
  ["shrink", list => { list.length = 10; }],
  ["fraction", list => { list[3] = 1.5; }],
  ["hole", list => { delete list[4]; }],
  ["push", list => { list.push(1, 2, 3); }],
  ["reverse", list => { list.reverse(); }],
  ["sort", list => { list.sort((a, b) => a - b); }],
  ["fill", list => { list.fill(2, 1, 5); }],
  ["copy", list => { list.copyWithin(0, 5, 9); }],
  ["freeze", list => { Object.freeze(list); }],
  ["seal", list => { Object.seal(list); }],
  ["named", list => { (list as unknown as { extra: number }).extra = 1; }],
];
function counted(size: number): number[] {
  const list: number[] = [];
  for (let i = 0; i < size; i++) list.push(i & 255);
  return list;
}
const makers: [string, () => number[]][] = [
  ["pushed", () => counted(20000)],
  ["by-length", () => new Array<number>(150000).fill(1)],
  ["by-length-stored", () => { const list = new Array<number>(120000); for (let i = 0; i < list.length; i++) list[i] = i & 7; return list; }],
  ["from", () => Array.from({ length: 110000 }, (_, i) => i & 3)],
  ["short", () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ["fractions", () => { const list = counted(20000); list[0] = 0.5; return list; }],
];
function walk(makerName: string, make: () => number[], a: number, b: number): void {
  const list = make();
  let text = makerName + " " + changes[a][0] + " " + changes[b][0] + " " + digest(list);
  for (const index of [a, b, a]) {
    try {
      changes[index][1](list);
    } catch (error) {
      text += " threw " + (error as Error).name;
    }
    let sum = 0;
    for (let i = 0; i < list.length && i < 40; i++) sum += list[i] ?? -1;
    try {
      list[2] = 9;
      list[list.length - 1] = 4;
    } catch (error) {
      text += " store threw " + (error as Error).name;
    }
    text += " " + sum + " " + digest(list);
  }
  lines.push(text);
}
for (const [name, make] of makers) for (let a = 0; a < changes.length; a++) for (let b = 0; b < changes.length; b++) if (a !== b && (a * 17 + b + name.length) % 4 === 0) walk(name, make, a, b);

function inOneFunction(): void {
  const queue: number[] = [];
  for (let i = 0; i < 30000; i++) queue.push(i);
  let sum = 0;
  while (queue.length > 5) {
    sum = (sum + queue[0] + queue[queue.length - 1]) % 1000003;
    queue.shift();
    queue.shift();
    if ((queue.length & 4095) === 1) queue.unshift(queue.length);
  }
  lines.push("queue " + sum + " " + queue.join());
  const table = new Array<number>(130000);
  for (let i = 0; i < table.length; i++) table[i] = i;
  let total = 0;
  for (let i = 0; i < table.length; i++) total = (total + table[i]) % 1000003;
  table.shift();
  table[5] = 0.25;
  for (let i = 0; i < table.length; i++) total = (total + table[i]) % 1000003;
  lines.push("table " + total);
}
inOneFunction();
console.log(lines.join("\n"));
