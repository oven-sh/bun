let calls = 0;
class Refusal {
  rows: number[];
  constructor(rows: number[]) { this.rows = rows; }
}
class Counter {
  total = 0;
  constructor(public step: number) {}
  add(value: number): number { this.total = (this.total + value * this.step) | 0; calls++; return this.total; }
}
const counter = new Counter(3);
function check(list: number[], rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds * 10; round++) {
    try {
      counter.add(round + list.length);
      if (round % 10 === 0) throw round;
    } catch {
      sum = (sum + counter.total) | 0;
    }
  }
  return sum & 1023;
}
const plain = [1, 2, 3];
const marked = [1, 2, 3];
(marked as unknown as { extra: string }).extra = "e";
let inAll = 0;
for (let turn = 0; turn < 300; turn++) inAll += check(plain, 3) + check(marked, 3);
console.log(calls, inAll);
