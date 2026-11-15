const unseen = (x: any): any => [x][JSON.parse("0")];
const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Box { a: Flags; t: Flags; constructor(a: number) { this.a = (a & 7) as Flags; this.t = Flags.A; } }
const shelf: Box[] = [];
function spin(k: any, d: any): number {
  const n = k | 0;
  const u: any = d === true ? undefined : 2;
  const p = new Box(5);
  let seen = 0;
  for (let i = 0; i < n; i++) { seen = (seen + p.a) | 0; p.a = u; }
  shelf[0] = p;
  return seen;
}
const spins: ((k: any, d: any) => number)[] = [spin, unseen(spin)];
unseen(new Box(0));
let last = 0;
for (let i = 0; i < 300; i++) last = spins[JSON.parse("0")](unseen(2), unseen(false));
console.log("warm", last);
console.log("hurt", spins[JSON.parse("0")](unseen(2), unseen(true)));
export {};
