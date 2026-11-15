// A linked list is built and walked.
// Sizes: 250 1000 4000
// Passes: 7700
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Link {
  next: Link | null = null;
  constructor(public value: number) {}
  weigh(): number {
    return this.value & 31;
  }
}
function build(count: number): Link {
  const head = new Link(0);
  let last = head;
  for (let i = 1; i < count; i++) {
    last.next = new Link(i);
    last = last.next;
  }
  return head;
}
function walk(head: Link): number {
  let sum = 0;
  for (let at: Link | null = head; at; at = at.next) sum += at.weigh();
  return sum;
}
function once(): string {
  return [walk(build(size * 2))].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
