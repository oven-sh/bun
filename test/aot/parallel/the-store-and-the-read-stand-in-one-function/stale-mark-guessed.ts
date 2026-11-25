const unseen = (x: any): any => [x][JSON.parse("0")];
const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Box { a: Flags; t: Flags; constructor(a: number) { this.a = (a & 7) as Flags; this.t = Flags.A; } }
const shelf: Box[] = [];
function poke(c: any, d: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? undefined : 2;
  const x = shelf[0];
  x.t = Flags.B;
  work = (work + x.a) | 0;
  if (c === true) x.a = u;
  return x.a;
}
const pokes: ((c: any, d: any) => unknown)[] = [poke, unseen(poke)];
let last: unknown = 0;
for (let i = 0; i < 300; i++) { shelf[0] = unseen(new Box(i)); last = pokes[JSON.parse("0")](unseen((i & 1) === 1), unseen(false)); }
console.log("warm", typeof last, String(last));
shelf[0] = unseen(new Box(1));
const hurt = pokes[JSON.parse("0")](unseen(true), unseen(true));
console.log("hurt", typeof hurt, String(hurt));
const kept = unseen(shelf[0]);
console.log("behind", typeof kept.a, String(kept.a));
export {};
