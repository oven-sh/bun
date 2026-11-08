const unseen = (x: any): any => [x][JSON.parse("0")];
const say = (value: unknown): string => typeof value + ":" + String(value);
interface Pair { left: number; right: number; name: string }
function total(p: Pair): string { const a: unknown = p.left, b: unknown = p.right, c: unknown = p.name; return say(a) + say(b) + say(c); }
function hurtIt(p: Pair, c: boolean): void { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; if (c) { delete (p as any).right; } }
function run(seed: number, c: boolean): string {
  const p: Pair = { left: seed, right: seed + 1, name: "p" + seed };
  const before = total(p);
  hurtIt(p, c);
  return before + " > " + total(p) + Object.keys(p).join();
}
let last = "";
for (let i = 0; i < 300; i++) last = run(i, false);
console.log("warm", last);
console.log("hurt", run(5, true));
console.log("whole", run(6, false));
export {};
