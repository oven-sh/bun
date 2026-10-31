// Untyped code deletes, from typed records, a name that is not there. The answer follows from the Structure, so it is cached: the delete does not enter the runtime every time. A property added later is really deleted.
// Env: JSC_aotCountsPath=/dev/null
declare const aotRuntimeCounters: undefined | (() => string);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
interface Point { x: number; y: number; name: string; note?: string }
function makeTyped(i: number): Point { return { x: i, y: i + 1, name: "p" }; }
function makeMarked(i: number): Point { const made: Point = { x: i, y: i + 1, name: "p" }; (made as unknown as Record<string, number>).mark = i; return made; }
const deleteOther: (p: any) => any = function (p: any): any { return delete p.other; };
const deleteByKey: (p: any, k: any) => any = function (p: any, k: any): any { return delete p[k]; };
const other: string = JSON.parse('"other"');
const secret = Symbol("secret");
for (const [kind, make] of [["typed", makeTyped], ["marked", makeMarked]] as const) {
  const objects: Point[] = [];
  for (let i = 0; i < 100; i++) objects.push(make(i));
  let total = 0;
  for (const p of objects) total += p.x + p.y + p.name.length;
  for (const p of objects) total += (deleteOther(p) ? 1 : 0) + (deleteByKey(p, other) ? 1 : 0) + (deleteByKey(p, secret) ? 1 : 0);
  const before = countsSoFar();
  for (let round = 0; round < 50; round++) for (const p of objects) total += (deleteOther(p) ? 1 : 0) + (deleteByKey(p, other) ? 1 : 0) + (deleteByKey(p, secret) ? 1 : 0);
  console.log(kind, total, callsIn(countsSoFar()) - callsIn(before) < 100);
}
const show = (p: object): string => Object.keys(p).join() + "|" + Object.getOwnPropertySymbols(p).length;
for (const make of [makeTyped, makeMarked]) {
  const p = make(1), loose: any = p;
  for (let i = 0; i < 3; i++) console.log(deleteOther(p), deleteByKey(p, other), deleteByKey(p, secret), show(p));
  loose.other = 1; loose[secret] = 2;
  console.log("other" in p, secret in p, show(p));
  console.log(deleteOther(p), "other" in p, deleteByKey(p, secret), secret in p, show(p));
  loose.other = 3;
  console.log(deleteByKey(p, other), "other" in p, loose.other, show(p));
  const inherits = make(2);
  Object.setPrototypeOf(inherits, { other: "above" });
  console.log(deleteOther(inherits), (inherits as any).other, deleteByKey(inherits, other), (inherits as any).other, show(inherits));
  const frozen = Object.freeze(make(3));
  console.log(deleteOther(frozen), deleteByKey(frozen, other), deleteByKey(frozen, secret), show(frozen));
  const locked = make(4), lockedLoose: any = locked;
  lockedLoose.other = 1;
  Object.defineProperty(locked, "other", { configurable: false });
  try { console.log(deleteOther(locked)); } catch (error) { console.log((error as Error).name); }
  try { console.log(deleteByKey(locked, other)); } catch (error) { console.log((error as Error).name); }
  console.log(show(locked));
}
