// A function with more parameters than there are registers for them gets the last ones on the stack. Once it has set such a parameter to null, what the caller passed is collected while the function still runs.
// Prints what the compiler saves: objects that are collected earlier
// Todo on win32 x64: Not every time: row 3517: some lines print that the object is kept: native frames there have home slots that nobody writes, and the collector reads what an earlier call left in them
// Todo: Not every time: row 2989: the object is kept until the function returns: the store that let go of it wrote to a word of the caller's frame, which is not always this call's (row 3608), and is out
type Thing = { id: number; payload: number[] };
let made = 0;
function make(): Thing {
  return { id: ++made, payload: Array.from({ length: 50 }, (_, i) => i + made) };
}
let sum = 0;
function use(thing: Thing | null | undefined, more: number): void {
  sum += (thing?.payload.length ?? 0) + more;
}
function other(): number {
  sum += made;
  return sum & 1;
}
const lines: string[] = [];
const say = (form: string, gone: boolean) => lines.push(`${form}: ${gone ? "collected" : "KEPT"}`);
function last(a: Thing, b: Thing, c: Thing, d: Thing, e: Thing, f: Thing, g: Thing, h: Thing, i: Thing, j: Thing, x: Thing | null, more: number): boolean {
  const ref = new WeakRef(x!);
  use(x, a.id + b.id + c.id + d.id + e.id);
  use(x, more + f.id + g.id + h.id + i.id + j.id);
  x = null;
  Bun.gc(true);
  use(a, 0); use(b, 0); use(c, 0); use(d, 0); use(e, 0); use(f, 0); use(g, 0); use(h, 0); use(i, 0); use(j, 0);
  return ref.deref() === undefined;
}
const k = [make(), make(), make(), make(), make(), make(), make(), make(), make(), make()];
say("the eleventh parameter", last(k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], make(), 0));
say("the eleventh parameter, across a call", last(k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9], make(), other()));
console.log(lines.join("\n"));
console.log(sum > 0);
