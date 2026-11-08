// A variable that the program sets to null lets go of what it held while the function still runs, also in the version of the function that runs where its guard turns away.
// The bodies of local() and parameter() name no built-in: what makes the reference, collects and asks stands in functions of its own.
// Todo on win32 x64: in each of four runs of CI plain Bun printed "a parameter: KEPT | KEPT" and the executable "a parameter: KEPT | collected": native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them, in plain Bun too. The line "a local" is left out there: plain Bun itself printed "KEPT | KEPT" three times and "collected | KEPT" once in those runs
type Thing = { id: number; payload: number[] };
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
let made = 0;
function make(): Thing { return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) }; }
function refTo(thing: Thing): WeakRef<Thing> { return new WeakRef(thing); }
function collect(): void { Bun.gc(true); }
function isGone(ref: WeakRef<Thing>): boolean { return ref.deref() === undefined; }
let sum = 0;
function use(thing: Thing | null, more: number): void { sum += (thing ? thing.payload.length : 0) + more; }
function local(tag: Tag): boolean {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
  let x: Thing | null = make();
  const ref = refTo(x);
  use(x, work);
  use(x, 1);
  x = null;
  collect();
  return isGone(ref);
}
function parameter(tag: Tag, x: Thing | null): boolean {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0;
  const ref = refTo(x!);
  use(x, work);
  use(x, 1);
  x = null;
  collect();
  return isGone(ref);
}
const real = new Tag(), liar = unseen({ n: 1, m: 2 });
for (let turn = 0; turn < 30; turn++) { local(real); parameter(real, make()); }
const referenceWavers = process.platform === "win32" && process.arch === "x64";
const said = (gone: boolean): string => (referenceWavers ? "left out" : gone ? "collected" : "KEPT");
console.log("a local:", said(local(real)), "|", said(local(liar)));
console.log("a parameter:", parameter(real, make()) ? "collected" : "KEPT", "|", parameter(liar, make()) ? "collected" : "KEPT");
console.log(sum > 0);
