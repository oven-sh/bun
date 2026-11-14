// a function with a loop of its own is copied into a loop of its caller, and leaves by a `return` that stands under a `try` in a turn of that loop
class Limits {
  most: number;
  constructor(most: number) {
    this.most = most;
  }
}
let current: Limits = new Limits(5);
function firstOver(list: number[], weigh: (x: number) => number): number {
  const limits = current;
  for (let i = 0; i < list.length; i++) {
    try {
      if (weigh(list[i]) > limits.most) return i;
    } catch {
      continue;
    }
  }
  return -1;
}
function deed(turns: number) {
  const list = [1, 2, 3, 4];
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    total += firstOver(list, x => {
      if (x === 2 && turn % 5 === 4) throw new Error("no weight");
      return x * (turn & 3);
    });
  }
  return total;
}
console.log(String(deed(1)), String(deed(4)), String(deed(5)));
console.log(String(deed(300)));
current = JSON.parse('{"most":2}');
console.log(String(deed(300)));
