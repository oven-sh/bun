// The inner loop stores into the links; the first one becomes read-only, gets a setter, is frozen.
class Link {
  v: number;
  w: number;
  next: Link | null;
  constructor(v: number, w: number, next: Link | null) {
    this.v = v;
    this.w = w;
    this.next = next;
  }
}
const out: unknown[] = [];
function walk(head: Link, change: (x: any, r: number) => void): void {
  for (let r = 0; r < 4; r++) {
    let hits = 0;
    try {
      for (let n: Link | null = head; n; n = n.next) {
        if (hits++ < 2) n.v = n.v + 1;
        else n.w = n.w + 1;
      }
    } catch (error) {
      out.push((error as Error).constructor.name);
    }
    out.push(hits, head.v, head.w);
    change(head, r);
  }
}
function list(): any {
  return JSON.parse("0", () => new Link(1, 2, new Link(3, 4, new Link(5, 6, null))));
}
walk(list(), (x, r) => {
  if (r === 0) Object.defineProperty(x, "v", { value: 9, writable: false });
});
walk(list(), (x, r) => {
  if (r === 0)
    Object.defineProperty(x, "v", {
      get: () => 70,
      set(value) {
        out.push("set " + value);
      },
    });
});
walk(list(), (x, r) => {
  if (r === 0) Object.freeze(x);
});
walk(list(), (x, r) => {
  if (r === 0) delete x.v;
  if (r === 1) x.v = 1;
});
walk(list(), (x, r) => {
  if (r === 0) x.v = { valueOf: () => 4 };
  if (r === 1) x.extra = 1;
});
console.log(out.join(" "));
