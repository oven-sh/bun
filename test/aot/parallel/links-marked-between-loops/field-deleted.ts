// The first link loses a field behind the first iteration of the outer loop.
class Link {
  v: boolean;
  w: boolean;
  next: Link | null;
  constructor(v: boolean, w: boolean, next: Link | null) {
    this.v = v;
    this.w = w;
    this.next = next;
  }
}
const out: number[] = [];
function walk(head: Link): void {
  for (let r = 0; r < 3; r++) {
    let hits = 0;
    for (let n: Link | null = head; n !== null; n = n.next) {
      if (n.v) hits++;
      if (n.w === undefined) hits += 100;
    }
    out.push(hits);
    if (r === 0) delete (head as any).w;
  }
}
const list: any = JSON.parse("0", () => new Link(true, false, new Link(false, true, null)));
walk(list);
console.log(out.join());
