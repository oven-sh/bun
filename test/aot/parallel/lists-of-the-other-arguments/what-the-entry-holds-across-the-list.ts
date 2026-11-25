// The receiver, the captured values, the parameters in front and the count of arguments are all read BEHIND the making of the list; so many lists are made that the allocator runs dry in the middle again and again.
type Called = (this: { name: string }, first?: string, second?: number, ...rest: number[]) => string;
function add(rest: number[]) { let sum = 0; for (const value of rest) sum += value; return sum; }
function makers(captured: string, alsoCaptured: number): Called[] {
  return [
    function (first, second, ...rest) { return "A" + this.name + captured + alsoCaptured + first + second + ":" + arguments.length + ":" + rest.length + ":" + add(rest); },
    function (first, second, ...rest) { return "B" + this.name + alsoCaptured + captured + first + second + ":" + arguments.length + ":" + rest.length + ":" + add(rest); },
    function (first, ...rest) { return "C" + this.name + captured + first + ":" + arguments.length + ":" + rest.length + ":" + rest.join(); } as Called,
    function (...rest) { return "D" + this.name + alsoCaptured + ":" + arguments.length + ":" + rest.length + ":" + rest.join(); } as Called,
    function (first, second, third, fourth, fifth, ...rest) { return "E" + this.name + captured + first + second + third + fourth + fifth + ":" + rest.length + ":" + rest.join(); } as Called,
  ];
}
const made = [...makers("a", 1), ...makers("b", 2)];
const receivers = [{ name: "x" }, { name: "y" }];
const kept: number[][] = [];
function keeps(...rest: number[]) { kept.push(rest); if (kept.length > 5000) kept.length = 0; return rest; }
function drops(...rest: number[]) { return rest; }
function turns(...rest: number[]) { rest.reverse(); return rest; }
const byValue = [keeps, drops, turns];
let check = 0;
const seen = new Set<string>();
for (let turn = 0; turn < 300000; turn++) {
  const called = made[turn % 10], receiver = receivers[turn % 2];
  let text: string;
  switch (turn % 7) {
    case 0: text = called.call(receiver, "p", turn % 3); break;
    case 1: text = called.call(receiver, "q", turn % 3, 1); break;
    case 2: text = called.call(receiver, "r", turn % 3, 1, 2); break;
    case 3: text = called.call(receiver, "s", turn % 3, 1, 2, 3, 4, 5, 6, 7); break;
    case 4: text = called.call(receiver, "t"); break;
    case 5: text = called.call(receiver, "u", turn % 3, 1, 2, 3); break;
    default: text = called.call(receiver); break;
  }
  seen.add(text);
  const list = byValue[turn % 3](turn, turn + 1, turn + 2);
  check = (check + list[0] + list[1] * 3 + list[2] * 5 + list.length) % 1000003;
}
console.log([...seen].sort().join("\n"));
console.log(check, kept.length, kept[kept.length - 1].join());
