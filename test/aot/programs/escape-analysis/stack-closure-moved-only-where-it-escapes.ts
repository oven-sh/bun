// A stack-allocated closure is moved to the heap only in the branch where it escapes.
const saved: ((x: number) => void)[] = [];
const keepers: number[][] = [];
function keeping(list: number[]): number[] { keepers.push(list); return list; }
function isKept(list: number[]): boolean { return keepers.indexOf(list) >= 0; }
function hold(list: number[], callback: (x: number) => void): void { saved.push(callback); for (let i = 0; i < list.length; i++) callback(list[i]); }
function sum(list: number[]): string {
  let n = 0;
  let text = "";
  if (isKept(list)) hold(list, x => { n += x; text += x; }); else list.forEach(x => { n += x; text += x; });
  n += 1000;
  if (saved.length) saved[saved.length - 1](5);
  return n + ":" + text;
}
function inLoop(even: number[], odd: number[], turns: number): string {
  let n = 0;
  let text = "t";
  const before = saved.length;
  for (let i = 0; i < turns; i++) {
    const list = i & 1 ? odd : even;
    if (isKept(list)) hold(list, x => { n += x; text += x; }); else list.forEach(x => { n += x; text += x; });
    n += 100;
  }
  for (let i = before; i < saved.length; i++) saved[i](1);
  return n + ":" + text + ":" + (saved.length - before);
}
function bornInLoop(even: number[], odd: number[], turns: number): string {
  let out = "";
  for (let i = 0; i < turns; i++) {
    let n = i;
    let text = "b" + i;
    const list = i & 1 ? odd : even;
    if (isKept(list)) hold(list, x => { n += x; text += x; }); else list.forEach(x => { n += x; text += x; });
    out += n + text + ";";
  }
  return out;
}
const plain = [1, 2, 3];
const keeper = keeping([4, 5]);
let out = "";
for (let i = 0; i < 300; i++) {
  const a = sum(i % 7 === 3 ? keeper : plain);
  const b = i % 5 === 2 ? inLoop(plain, keeper, 4) : inLoop(plain, plain, 2);
  const c = i % 4 === 1 ? bornInLoop(keeper, plain, 3) : bornInLoop(plain, plain, 1);
  if (i % 37 === 0 || i % 7 === 3 && i < 20) out += a + "|" + b + "|" + c + "\n";
  if (saved.length > 50) saved.length = 0;
}
console.log(out);
