class Limits { most: number; constructor(most: number) { this.most = most; } }
let current: Limits = new Limits(5);
function firstOver(weigh: (x: number) => number): number {
  const limits = current;
  for (let i = 0; i < 4; i++) {
    try {
      if (weigh(i) > limits.most) return 7;
    } catch {
    }
  }
  return -1;
}
function triple(x: number) { return x * 3; }
function deed(turns: number) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += firstOver(triple);
  return total;
}
console.log(String(deed(1)), String(deed(4)), String(deed(9)));
current = JSON.parse('{"most":2}');
console.log(String(deed(30)));
