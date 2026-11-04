// the same with a `finally` that counts, and a return of what the callback gives
class Limits { most: number; constructor(most: number) { this.most = most; } }
let current: Limits = new Limits(5);
let left = 0;
function firstOver(weigh: (x: number) => number): number {
  const limits = current;
  for (let i = 0; i < 4; i++) {
    try {
      if (weigh(i) > limits.most) return weigh(i);
      if (i === 2) throw new Error("two");
    } catch {
      continue;
    } finally {
      left++;
    }
  }
  return -1;
}
function deed(turns: number) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += firstOver(x => x * (turn & 3));
  return total;
}
console.log(String(deed(1)), String(deed(4)), String(deed(9)), String(left));
current = JSON.parse('{"most":2}');
console.log(String(deed(30)), String(left));
