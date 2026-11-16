let calls = 0;
class Refusal {
  rows: number[];
  constructor(rows: number[]) { this.rows = rows; }
}
function check(list: number[], rounds: number): number {
  let refused = 0;
  for (let round = 0; round < rounds; round++) {
    try {
      throw new Refusal(list.filter(x => { calls++; return x > 1; }));
    } catch {
      refused++;
    }
  }
  return refused;
}
const plain = [1, 2, 3];
const marked = [1, 2, 3];
(marked as unknown as { extra: string }).extra = "e";
let inAll = 0;
for (let turn = 0; turn < 300; turn++) inAll += check(plain, 3) + check(marked, 3);
console.log(calls, inAll);
