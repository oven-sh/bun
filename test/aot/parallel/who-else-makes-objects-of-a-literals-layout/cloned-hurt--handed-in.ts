const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
interface Crate { tint: Tint; more: Tint; lit: boolean; name: string; part: { deep: number } }
function makeCrate(seed: number): Crate { return { tint: (seed & 7) as Tint, more: Tint.Red, lit: seed > 2, name: "n" + seed, part: { deep: seed } }; }
function hurtCrate(seed: number): Crate { const one = makeCrate(seed); delete (one as any).tint; delete (one as any).name; return one; }
function hurtLast(seed: number): Crate { const one = makeCrate(seed); delete (one as any).part; return one; }
function tell(x: Crate): string { return say(x.tint) + " " + say(x.more) + " " + say(x.lit) + " " + say(x.name) + " " + say(x.part === undefined || x.part === null ? x.part : x.part.deep) + " [" + Object.keys(x).join() + "]"; }
function run(x: Crate): string {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  work = (work + x.more) | 0;
  return tell(x) + " " + work;
}
const runs: ((...all: any[]) => string)[] = [run, unseen(run)];
unseen(makeCrate(0));
for (let i = 0; i < 6; i++) { try { unseen(structuredClone(hurtCrate(6))); } catch {} }
let last = "";
for (let i = 0; i < 300; i++) last = runs[JSON.parse("0")](makeCrate(i));
console.log("warm", last);
console.log("odd", runs[JSON.parse("0")](structuredClone(hurtCrate(6))));
console.log("again", runs[JSON.parse("0")](makeCrate(7)));
export {};
