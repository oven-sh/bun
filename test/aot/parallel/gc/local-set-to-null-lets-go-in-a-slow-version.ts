// A variable that the program sets to null lets go of what it held while the function still runs, also in the version of the function that runs where its guard turns away.
// The bodies of local() and parameter() name no built-in: what makes the reference, collects and asks stands in functions of its own.
// Todo on win32 x64: "collected" | "KEPT": in each of four runs of CI the executable printed "a parameter: KEPT | collected": native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
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
// What is expected is written below and is not what plain Bun prints: plain Bun itself keeps one of the four objects now and then, on Windows and on Linux:
// in 53 of 4,000 runs on Linux x64, where the executable kept none in 4,000.
const said = (gone: boolean): string => (gone ? "collected" : "KEPT");
console.log("a local:", said(local(real)), "|", said(local(liar)));
console.log("a parameter:", said(parameter(real, make())), "|", said(parameter(liar, make())));
console.log(sum > 0);
/* Output:
a local: collected | collected
a parameter: collected | collected
true
*/
