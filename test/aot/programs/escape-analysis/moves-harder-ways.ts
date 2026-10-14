// Stack-allocated closures are moved to the heap on paths with exceptions, loops and nested calls.
const saved: ((x: number) => void)[] = [];
const keepers: number[][] = [];
const throwers: number[][] = [];
function keeping(list: number[], fails: boolean): number[] { keepers.push(list); if (fails) throwers.push(list); return list; }
function isKept(list: number[]): boolean { return keepers.indexOf(list) >= 0; }
function hold(list: number[], callback: (x: number) => void): void {
  saved.push(callback);
  const fails = throwers.indexOf(list) >= 0;
  for (let i = 0; i < list.length; i++) { callback(list[i]); if (fails && i === 0) throw new Error("stop"); }
}
function holdMap(list: number[], callback: (x: number) => number): number[] {
  saved.push(callback as (x: number) => void);
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) out.push(callback(list[i]));
  return out;
}
function throwsInTheArm(list: number[]): string {
  let n = 0;
  let text = "x";
  try { if (isKept(list)) hold(list, x => { n += x; text += x; }); else list.forEach(x => { n += x; text += x; }); } catch (e) { text += (e as Error).message; n += 7; }
  n += 1000;
  if (saved.length) saved[saved.length - 1](3);
  return n + ":" + text;
}
function initializedLater(list: number[]): string {
  let n = 0;
  let ready = false;
  if (isKept(list)) hold(list, x => { n += x + (ready ? late.length : 0); }); else list.forEach(x => { n += x + (ready ? late.length : 0); });
  const late = "late" + n;
  ready = true;
  if (saved.length) saved[saved.length - 1](1);
  return n + ":" + late;
}
function twoArms(first: number[], second: number[]): string {
  let n = 0;
  if (isKept(first)) hold(first, x => { n += x; }); else first.forEach(x => { n += x; });
  const mapped = isKept(second) ? holdMap(second, x => { n += 1; return x + n; }) : second.map(x => { n += 1; return x + n; });
  n += 10;
  for (let i = Math.max(0, saved.length - 2); i < saved.length; i++) saved[i](100);
  return n + ":" + mapped.join();
}
function neverAssigned(list: number[]): string {
  let n = 0;
  let nothing: number | undefined;
  if (isKept(list)) hold(list, x => { n += x + (nothing === undefined ? 1 : nothing); }); else list.forEach(x => { n += x + (nothing === undefined ? 1 : nothing); });
  if (saved.length) saved[saved.length - 1](2);
  return n + ":" + nothing;
}
const plain = [1, 2, 3];
const keeper = keeping([4, 5], false);
const thrower = keeping([6, 7], true);
let out = "";
for (let i = 0; i < 240; i++) {
  const a = throwsInTheArm(i % 6 === 1 ? thrower : i % 6 === 4 ? keeper : plain);
  const b = initializedLater(i % 5 === 3 ? keeper : plain);
  const c = twoArms(i % 4 === 2 ? keeper : plain, i % 3 === 1 ? keeper : plain);
  const d = neverAssigned(i % 7 === 2 ? keeper : plain);
  if (i < 13 || i % 60 === 0) out += a + "|" + b + "|" + c + "|" + d + "\n";
  if (saved.length > 40) saved.length = 0;
}
console.log(out);
