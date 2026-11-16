// Fields that loops step up to 2 ** 53 and down to -(2 ** 53): there a number stays where it is, and the integer is held to it.
class Counter {
  constructor(
    public at: number,
    public other: number,
  ) {}
  up(): number {
    return this.at++;
  }
  down(): number {
    return --this.other;
  }
  twice(): number {
    this.at++;
    this.at++;
    return this.at;
  }
}
function climb(counter: Counter, turns: number): string {
  let last = 0;
  let same = 0;
  for (let turn = 0; turn < turns; turn++) {
    const now = counter.up();
    if (now === last) same++;
    last = now;
  }
  return `${last} ${same} ${counter.at}`;
}
function fall(counter: Counter, turns: number): string {
  let same = 0;
  for (let turn = 0; turn < turns; turn++) {
    const before = counter.other;
    if (counter.down() === before) same++;
  }
  return `${same} ${counter.other}`;
}
function both(counter: Counter, turns: number): string {
  let seen = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (counter.twice() === 9007199254740992) seen++;
    counter.down();
    counter.down();
  }
  return `${seen} ${counter.at} ${counter.other}`;
}
class Stack {
  items = new Int32Array(8);
  depth = 0;
  far = 9007199254740985;
  push(value: number): void {
    this.items[this.depth++] = value;
    this.items[this.far++] = value;
  }
  pop(): number {
    return this.items[--this.depth];
  }
}
function run(stack: Stack, turns: number): string {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    stack.push(turn);
    stack.push(3);
    sum += stack.pop() - stack.pop();
  }
  return `${sum} ${stack.depth} ${stack.far} ${stack.items.join()}`;
}
for (let round = 0; round < 2; round++) {
  console.log(climb(new Counter(9007199254740980, 0), 30), fall(new Counter(0, -9007199254740980), 30), both(new Counter(9007199254740981, -9007199254740983), 20));
  console.log(climb(new Counter(0, 0), 30), fall(new Counter(0, 0), 30), both(new Counter(2147483640, -2147483640), 20));
  console.log(run(new Stack(), 12));
}
