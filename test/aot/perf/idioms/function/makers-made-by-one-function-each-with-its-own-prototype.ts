import { nextTurns } from "../host.ts";
// One function makes a prototype object and a maker of objects below it. It is called four times at the top level, so one Object.create has four prototype objects.
const held = "~lib/held", evaluate = "~lib/evaluate";
type Made = { [key: string]: any };
type Options = { op: string; [key: string]: any };
const base = { describe(this: Made): string { return this.op; } };
const makeMembers = (options: Options) => ({ ...base, op: options.op, [evaluate]: options[evaluate] });
const makeMaker = (options: Options) => {
  const members = makeMembers(options);
  return function (value: number): Made {
    const self = Object.create(members);
    self[held] = value;
    return self;
  };
};
const add = makeMaker({ op: "add", [evaluate](this: Made, by: number): number { return this[held] + by; } });
const subtract = makeMaker({ op: "subtract", [evaluate](this: Made, by: number): number { return this[held] - by; } });
const double = makeMaker({ op: "double", [evaluate](this: Made, by: number): number { return this[held] * 2 + by; } });
const negate = makeMaker({ op: "negate", [evaluate](this: Made, by: number): number { return by - this[held]; } });
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const made = (i & 3) === 0 ? add(i & 7) : (i & 3) === 1 ? subtract(i & 7) : (i & 3) === 2 ? double(i & 7) : negate(i & 7);
    s += made[evaluate](1);
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n);
console.log(check);
