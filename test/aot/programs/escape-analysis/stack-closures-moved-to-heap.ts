// Stack-allocated closures that must be moved to the heap on the paths where they escape.
const saved: ((x: number) => void)[] = [];
const keepers: number[][] = [];
function keeping(list: number[]): number[] { keepers.push(list); return list; }
function isKept(list: number[]): boolean { return keepers.indexOf(list) >= 0; }
function hold(list: number[], callback: (x: number) => void): void { saved.push(callback); for (let i = 0; i < list.length; i++) callback(list[i]); }
function usedBehindTheMove(list: number[], flag: boolean): string {
  let n = 0;
  const a = (): number => ++n;
  const b = (): number => n + 100;
  const f = flag ? a : b;
  if (isKept(list)) hold(list, x => { n += x; }); else list.forEach(x => { n += x; });
  const first = f();
  if (saved.length) saved[saved.length - 1](1000);
  return first + ":" + f() + ":" + n;
}
function doneAheadOfTheMove(list: number[], flag: boolean): string {
  let n = 0;
  const a = (): number => ++n;
  const b = (): number => n + 100;
  const f = flag ? a : b;
  const first = f() + f();
  if (isKept(list)) hold(list, x => { n += x; }); else list.forEach(x => { n += x; });
  if (saved.length) saved[saved.length - 1](1000);
  return first + ":" + n;
}
function roundALoop(list: number[], flag: boolean): string {
  let n = 0;
  const a = (): number => ++n;
  const b = (): number => n + 100;
  const f = flag ? a : b;
  let text = "";
  for (let i = 0; i < 3; i++) {
    text += f() + ",";
    if (isKept(list)) hold(list, x => { n += x; }); else list.forEach(x => { n += x; });
    if (saved.length) saved[saved.length - 1](1000);
  }
  return text + n;
}
const plain = [1, 2, 3];
const keeper = keeping([4, 5]);
let out = "";
for (let i = 0; i < 120; i++) {
  const list = i % 4 === 1 ? keeper : plain;
  const a = usedBehindTheMove(list, i % 2 === 0), b = doneAheadOfTheMove(list, i % 3 === 0), c = roundALoop(list, i % 2 === 1);
  if (i < 9 || i % 40 === 0) out += a + "|" + b + "|" + c + "\n";
  if (saved.length > 30) saved.length = 0;
}
console.log(out);
