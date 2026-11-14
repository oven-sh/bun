// `id = Node.next++` in classes and heirs: the old value is an int32 wherever it is read, and what counts goes round the loop in a register.
// STATISTIC: SlotsCarriedAroundLoops >= 1
class Node {
  static next = 1;
  id = Node.next++;
}
class Leaf extends Node {
  constructor(public value: number) {
    super();
  }
}
class Pair extends Node {
  constructor(
    public left: Leaf,
    public right: Leaf,
  ) {
    super();
  }
}
function run(turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const pair = new Pair(new Leaf(turn), new Leaf(turn + 1));
    sum = (sum + pair.id + pair.left.id * 3 + pair.right.id) & 1023;
  }
  return sum;
}
class Late {
  static next = 2147483640;
  id = Late.next--;
  other = Late.next++;
}
function late(turns: number): string {
  let seen = "";
  for (let turn = 0; turn < turns; turn++) {
    const one = new Late();
    seen += one.id - one.other;
    Late.next += 3;
  }
  return seen + Late.next;
}
class Texts {
  static next: any = 1;
  id = Texts.next++;
}
function texts(turns: number, at: number): string {
  let seen = "";
  for (let turn = 0; turn < turns; turn++) {
    if (turn === at) Texts.next = at & 1 ? "7" : 0.5;
    if (turn === at + 3) Texts.next = undefined;
    seen += new Texts().id + ",";
  }
  return seen;
}
for (let round = 0; round < 3; round++) console.log(run(100), Node.next, late(8), texts(9, round + 2));
