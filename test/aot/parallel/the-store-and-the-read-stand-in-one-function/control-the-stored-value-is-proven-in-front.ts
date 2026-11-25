const unseen = (x: any): any => [x][JSON.parse("0")];
const enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Cfg { k: Flags; j: Flags; constructor() { this.k = Flags.B; this.j = Flags.A; } }
class Box { a: Flags; t: Flags; next: Box | undefined;
  constructor(a: number, next: Box | undefined) { this.a = (a & 7) as Flags; this.t = Flags.A; this.next = next; } }
let head: Box | undefined = undefined;
let cfg: Cfg = unseen(new Cfg());
function sweep(v: any): number {
  const c = cfg;
  const w = (v | 0) as Flags;
  let s = 0;
  for (let x = head; x !== undefined; x = x.next) {
    s = (s + x.a) | 0;
    x.t = w;
    s = (s + c.k + c.j) | 0;
  }
  return s;
}
const sweeps: ((v: any) => number)[] = [sweep, unseen(sweep)];
for (let i = 1; i <= 4; i++) head = unseen(new Box(i, head));
let last = 0;
for (let i = 0; i < 300; i++) last = sweeps[JSON.parse("0")](unseen(2));
console.log("sum", last, "t", String(unseen(head).t));
export {};
