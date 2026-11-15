// A field of the first link is deleted, and the prototype answers for it.
class Link {
  v: string;
  w: string;
  next: Link | null;
  constructor(v: string, w: string, next: Link | null) {
    this.v = v;
    this.w = w;
    this.next = next;
  }
}
const out: string[] = [];
function walk(head: Link): void {
  for (let r = 0; r < 3; r++) {
    let last = "";
    for (let n: Link | null = head; n !== null; n = n.next) {
      if (n.v) last = n.w;
      if (n.v === "a") break;
    }
    out.push(last);
    if (r === 0) {
      delete (head as any).w;
      (Link.prototype as any).w = "above";
    }
  }
}
const list: any = JSON.parse("0", () => new Link("a", "b", new Link("c", "d", null)));
walk(list);
console.log(out.join());
