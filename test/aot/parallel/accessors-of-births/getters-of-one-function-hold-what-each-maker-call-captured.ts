// The function needs its closure: each object has its own, over its own variables.
type Counter = { step: number; next: number; seen: number };
function make(start: number): Counter {
  let count = start, reads = 0;
  return { step: 1, get next(): number { reads++; count += this.step; return count; }, set next(to: number) { count = to; }, get seen(): number { return reads; } };
}
function pull(counter: Counter): number { return counter.next; }
function main() {
  const one = make(0), two = make(1000);
  two.step = 3;
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += pull(i & 1 ? one : two);
  one.next = -5;
  console.log(sum, pull(one), pull(two), one.seen, two.seen);
}
main();
