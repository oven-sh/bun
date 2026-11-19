// Long-lived objects that are born with a short array in a field: what the collector pays for them, beside what the births cost.
interface Node3 { id: number; items: number[]; next: Node3 | null }
class Bag { id: number; items: number[]; next: Bag | null; constructor(id: number, next: Bag | null) { this.id = id; this.items = []; this.next = next; } }
function make(n: number): Node3 | null {
  let head: Node3 | null = null;
  for (let i = 0; i < n; i++) head = { id: i, items: [i, i + 1, i + 2], next: head };
  return head;
}
function makeBags(n: number): Bag | null {
  let head: Bag | null = null;
  for (let i = 0; i < n; i++) { head = new Bag(i, head); if ((i & 3) === 0) head.items.push(i); }
  return head;
}
function sum(head: Node3 | null): number {
  let total = 0;
  for (let p = head; p; p = p.next) total += p.items[0] + p.items[2] + p.items.length + p.id;
  return total;
}
function sumBags(head: Bag | null): number {
  let total = 0;
  for (let p = head; p; p = p.next) total += p.items.length + p.id;
  return total;
}
let answer = 0;
const kept = make(10000);
const keptBags = makeBags(10000);
for (let round = 0; round < 20; round++) answer += sum(kept) + sumBags(keptBags);
for (let round = 0; round < 20; round++) answer += sum(make(1000)) + sumBags(makeBags(1000));
console.log(answer);
