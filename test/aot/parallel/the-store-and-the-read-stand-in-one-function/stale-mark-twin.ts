const unseen = (x: any): any => [x][JSON.parse("0")];
const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Box { a: Flags; t: Flags; constructor(a: number) { this.a = (a & 7) as Flags; this.t = Flags.A; } }
const shelf: Box[] = [];
function twin(c: any, d: any): unknown {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const u: any = d === true ? undefined : 2;
  const x = shelf[0];
  const y = shelf[1];
  x.t = Flags.B;
  work = (x.a + y.a + y.t) | 0;
  if (c === true) { x.a = u; return y.a; }
  return work;
}
const twins: ((c: any, d: any) => unknown)[] = [twin, unseen(twin)];
let last: unknown = 0;
for (let i = 0; i < 300; i++) { const b = unseen(new Box(i)); shelf[0] = b; shelf[1] = b; last = twins[JSON.parse("0")](unseen((i & 1) === 1), unseen(false)); }
console.log("warm", typeof last, String(last));
const one = unseen(new Box(1)); shelf[0] = one; shelf[1] = one;
const hurt = twins[JSON.parse("0")](unseen(true), unseen(true));
console.log("hurt", typeof hurt, String(hurt));
export {};
