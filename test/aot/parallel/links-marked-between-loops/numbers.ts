// The fields hold numbers; the first link gets undefined, a string, a getter and minus zero in turn.
class Link {
  v: number;
  w: number;
  next: Link | null = null;
  constructor(v: number, w: number) {
    this.v = v;
    this.w = w;
  }
}
const out: unknown[] = [];
function walk(head: Link, rounds: number, change: (x: any, r: number) => void): void {
  for (let r = 0; r < rounds; r++) {
    let sum = 0;
    let missing = 0;
    let last: unknown = "none";
    for (let n: Link | null = head; n; n = n.next) {
      if (n.v > 2) sum += n.w;
      else sum += n.w * 100;
      if (n.w === undefined) missing++;
      last = n.v;
    }
    out.push(sum, missing, last);
    change(head, r);
  }
}
function make(): Link {
  const first = new Link(1.5, 10);
  first.next = new Link(2, 20.5);
  first.next.next = new Link(3, 30);
  return first;
}
walk(JSON.parse("0", () => make()), 6, (x, r) => {
  if (r === 0) x.w = undefined;
  if (r === 1) x.w = "5";
  if (r === 2) Object.defineProperty(x, "w", { get: () => 7, configurable: true });
  if (r === 3) delete x.w;
  if (r === 4) x.w = -0;
});
walk(JSON.parse("0", () => make()), 3, (x, r) => {
  if (r === 0) delete x.v;
  if (r === 1) (Link.prototype as any).v = 50;
});
console.log(out.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
