// Neighbors that were right before: another link is marked, the mark is made inside the inner loop or before both, every caller is known.
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
const out: (number | string)[] = [];
function count(head: Link): number {
  let hits = 0;
  for (let n: Link | null = head; n !== null; n = n.next) {
    if (n.v) hits++;
    if (n.w === undefined) hits += 100;
  }
  return hits;
}
function second(head: Link): void {
  for (let r = 0; r < 3; r++) {
    let hits = 0;
    for (let n: Link | null = head; n !== null; n = n.next) {
      if (n.v) hits++;
      if (n.w === undefined) hits += 100;
    }
    out.push(hits);
    if (r === 0) delete (head.next as any).w;
  }
}
function inside(head: Link): void {
  for (let r = 0; r < 3; r++) {
    let hits = 0;
    for (let n: Link | null = head; n !== null; n = n.next) {
      if (n.v) hits++;
      if (r === 1 && n === head) delete (n as any).w;
      if (n.w === undefined) hits += 100;
    }
    out.push(hits);
  }
}
function same(head: Link): void {
  let steps = 0;
  let hits = 0;
  let n: Link | null = head;
  while (n !== null && steps < 6) {
    if (n.v) hits++;
    if (n.w === undefined) hits += 100;
    if (steps++ === 1) delete (n as any).w;
    if (steps > 3) n = n.next;
  }
  out.push(hits);
}
function replaced(head: Link): void {
  let first = head;
  for (let r = 0; r < 3; r++) {
    let hits = 0;
    for (let n: Link | null = first; n !== null; n = n.next) {
      if (n.v) hits++;
      if (n.w === undefined) hits += 100;
    }
    out.push(hits);
    first = new Link(true, true, first);
    if (r === 0) delete (first as any).w;
  }
}
function list(): any {
  return JSON.parse("0", () => new Link(true, false, new Link(false, true, null)));
}
second(list());
inside(list());
same(list());
replaced(list());
const marked = list();
out.push(count(marked));
delete marked.w;
out.push(count(marked), count(new Link(true, true, null)));
console.log(out.join());
