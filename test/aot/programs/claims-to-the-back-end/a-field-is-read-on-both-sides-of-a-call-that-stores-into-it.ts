class Counter {
  count = 0;
}

function bump(counter: Counter, depth: number): void {
  if (depth > 0) return bump(counter, depth - 1);
  counter.count += 1;
}

function around(counter: Counter): number {
  const before = counter.count;
  bump(counter, 2);
  return before * 100 + counter.count;
}

const counter = new Counter();
const seen: number[] = [];
for (let turn = 0; turn < 5; turn++) seen.push(around(counter));
console.log(seen.join(" "));
