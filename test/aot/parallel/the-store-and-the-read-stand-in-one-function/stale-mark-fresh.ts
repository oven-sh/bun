const unseen = (x: any): any => [x][JSON.parse("0")];
const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Box { a: Flags; t: Flags; constructor(a: number) { this.a = (a & 7) as Flags; this.t = Flags.A; } }
const shelf: Box[] = [];
function make(c: any, d: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? undefined : 2;
  const p = new Box(5);
  if (c === true) p.a = u;
  const r = p.a;
  shelf[0] = p;
  return r;
}
const makers: ((c: any, d: any) => unknown)[] = [make, unseen(make)];
unseen(new Box(0));
let last: unknown = 0;
for (let i = 0; i < 300; i++) last = makers[JSON.parse("0")](unseen((i & 1) === 1), unseen(false));
console.log("warm", typeof last, String(last));
const hurt = makers[JSON.parse("0")](unseen(true), unseen(true));
console.log("hurt", typeof hurt, String(hurt));
const kept = unseen(shelf[0]);
console.log("behind", typeof kept.a, String(kept.a));
export {};
