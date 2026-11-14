// The answer of a call that each turn gives alike comes round its own loop, not the loop outside it, whose inner loop may end without a turn: the build ended under proof-checks.
function add(total: any, value: any) { return total + value; }
function read0(map1: Map<string, number>, count: number) {
  let total: any = 0;
  for (let turn = 0; turn < count; turn++) {
    for (let inner = 0; inner < 3; inner++) {
      total = add(total, "k");
      map1.get("a");
      try {
      } catch {
      }
    }
  }
  return total;
}
function read1(map1: Map<string, number>, count: number, turns: number) {
  let total: any = 0;
  for (let turn = 0; turn < count; turn++) {
    for (let inner = 0; inner < turns - turn; inner++) {
      const found = map1.get("a");
      total = add(total, found === undefined ? "-" : found);
      try {
        if (found === 7) throw found;
      } catch {
        total = add(total, "!");
      }
    }
  }
  return total;
}
function read2(map1: Map<string, number>, count: number) {
  let total: any = "";
  for (let turn = 0; turn < count; turn++) {
    const outside = map1.get("b");
    for (let inner = 0; inner < turn; inner++) total = add(total, String(map1.get("a")) + outside);
    if (turn === 2) map1.set("a", 9);
  }
  return total;
}
console.log(read0(new Map([["a", 1]]), 3), read0(new Map(), 0));
console.log(read1(new Map([["a", 1]]), 3, 3), read1(new Map([["a", 7]]), 2, 1), read1(new Map(), 3, 0), read1(new Map(), 2, 2));
console.log(read2(new Map([["a", 1], ["b", 2]]), 5), read2(new Map(), 4));
export {};
