// To the checker a proxy over a function and what a bind makes of it are of the kind of the function. So the written kind of a callee lists the function, and what arrives is no closure of it:
// a test for its closures fails, nothing of what the function has captured lies in the value, and the call does what a call of the value does.
type Adder = (x: number) => number;

const adds = (base: number): Adder => (x) => base + x;

function behind(target: Adder, depth: number): Adder {
  let chain = target;
  for (let i = 0; i < depth; i++) chain = new Proxy(chain, {});
  return chain;
}

function sum(callee: Adder): number {
  let total = 0;
  for (let i = 0; i < 1000; i++) total = callee(total) | 0;
  return total;
}

class Holder {
  add: Adder;
  constructor(add: Adder) {
    this.add = add;
  }
  run(x: number): number {
    return this.add(x);
  }
  runOften(): number {
    let total = 0;
    for (let i = 0; i < 1000; i++) total = this.add(total) | 0;
    return total;
  }
}

class Counter {
  total = 0;
  step: number;
  bump: Adder;
  constructor(step: number) {
    this.step = step;
    this.bump = this.bumpBy.bind(this);
  }
  bumpBy(x: number): number {
    this.total += this.step * x;
    return this.total;
  }
}

function outcome(run: () => number): string {
  try {
    return String(run());
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "threw " + String(error);
  }
}

const kinds: [string, () => Adder][] = [
  ["closure", () => adds(1)],
  ["proxy", () => new Proxy(adds(2), {})],
  ["bound", () => adds(3).bind(null)],
  ["proxies over bound", () => behind(adds(4).bind(null), 3)],
  ["bound over proxies", () => behind(adds(5), 3).bind(null)],
  ["bound method", () => new Counter(6).bump],
  ["proxy over a bound method", () => new Proxy(new Counter(7).bump, {})],
];

for (const [label, make] of kinds) {
  const holder = new Holder(make());
  console.log(label + ": " + [make()(10), sum(make()), holder.run(10), new Holder(make()).runOften()].join(" "));
}

const sameSite: Adder[] = kinds.map(([, make]) => make());
let mixed = 0;
for (let turn = 0; turn < 300; turn++) mixed = sameSite[turn % sameSite.length](mixed) % 1000003;
console.log("in turns: " + mixed);

const revocable = Proxy.revocable(adds(8), {});
const alive = sum(revocable.proxy);
revocable.revoke();
console.log("revoked: " + alive + " " + outcome(() => sum(revocable.proxy)) + " " + outcome(() => new Holder(revocable.proxy).run(1)));
console.log("too deep: " + outcome(() => sum(behind(adds(9), 200000))) + " " + outcome(() => new Holder(behind(adds(10).bind(null), 200000)).runOften()));
console.log("afterward: " + sum(behind(adds(11), 50)));
