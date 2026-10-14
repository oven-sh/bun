// Closures moved from the stack to the heap stay valid when young-generation garbage collections run in between.
const saved: ((x: number) => void)[] = [];
const keepers: number[][] = [];
function keeping(list: number[]): number[] { keepers.push(list); return list; }
function isKept(list: number[]): boolean { return keepers.indexOf(list) >= 0; }
function hold(list: number[], callback: (x: number) => void): void { saved.push(callback); for (let i = 0; i < list.length; i++) callback(list[i]); }
function sum(list: number[], tag: string): number {
  let n = 0;
  let text = tag;
  let last: number[] = [];
  if (isKept(list)) hold(list, x => { n += x; text = text + x; last = [x, n]; }); else list.forEach(x => { n += x; text = text + x; last = [x, n]; });
  return n + text.length + last.length;
}
const plain = [1, 2, 3];
const keeper = keeping([4, 5]);
let total = 0;
let garbage: string[] = [];
for (let i = 0; i < 300000; i++) {
  total += sum(i % 1000 === 7 ? keeper : plain, "t" + (i & 7));
  garbage.push("g" + i);
  if (garbage.length > 2000) garbage = [];
  if (saved.length > 20) saved.length = 0;
}
console.log(total);
