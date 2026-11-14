// A field that a turn steps more than once is the integer that its slot took: the next step, and the position, go on from it.
class Stack {
  items = new Int32Array(64);
  list: number[] = new Array(64).fill(0);
  depth = 0;
  push(value: number): void {
    this.items[this.depth] = value;
    this.list[this.depth++] = value + 1;
  }
  pop(): number {
    const listed = this.list[--this.depth];
    return this.items[this.depth] + listed;
  }
}
function run(stack: Stack, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    stack.push(turn & 7);
    stack.push(3);
    sum += stack.pop() + stack.pop();
  }
  return sum + stack.depth;
}
class Cursor {
  constructor(
    readonly text: string,
    public at: number,
  ) {}
  pair(): number {
    return this.text.charCodeAt(++this.at) * 1000 + this.text.charCodeAt(++this.at);
  }
}
function pairs(cursor: Cursor, turns: number): number {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += cursor.pair() || 1;
  return sum;
}
class Far {
  constructor(public at: number) {}
  twice(list: number[]): string {
    const first = list[this.at++];
    const second = list[++this.at];
    return `${first},${second},${this.at}`;
  }
}
function far(from: number, turns: number): string {
  const one = new Far(from);
  let seen = "";
  for (let turn = 0; turn < turns; turn++) seen += one.twice([1, 2, 3, 4]) + ";";
  return seen;
}
for (let round = 0; round < 3; round++) console.log(run(new Stack(), 200), pairs(new Cursor("some text of letters", -1 - round), 12));
for (const from of [0, -3, 2147483645, 9007199254740988, 9007199254740992, -9007199254740992, 0.5, Number.NaN]) console.log(far(from, 4));
