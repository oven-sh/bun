// One object of a class gets an own property under the name of a method, in the middle of a loop of calls, each time in another way. That object answers with its own property from then on, and every other object of the class goes on answering with the method.
class Counter {
  step: number;
  constructor(step: number) { this.step = step; }
  next(from: number): number { return from + this.step; }
  twice(from: number): number { return this.next(this.next(from)); }
}
class Fast extends Counter {
  skip(from: number): number { return this.next(from) + 100; }
}

type Change = (target: object, replacement: (from: number) => number) => unknown;

const changes: [string, Change][] = [
  ["a store by text that is evaluated", new Function("target", "replacement", "target.next = replacement") as Change],
  ["a definition by text that is evaluated", new Function("target", "replacement", "Object.defineProperty(target, 'next', { value: replacement, configurable: true })") as Change],
  ["Object.assign", (target, replacement) => Object.assign(target, { next: replacement })],
  ["Reflect.set", (target, replacement) => Reflect.set(target, "next", replacement)],
  ["Reflect.defineProperty", (target, replacement) => Reflect.defineProperty(target, "next", { value: replacement, writable: true, configurable: true })],
  ["a store under a computed name", (target, replacement) => { (target as Record<string, unknown>)[["ne", "xt"].join("")] = replacement; }],
  ["a getter", (target, replacement) => Object.defineProperty(target, "next", { get() { return replacement; }, configurable: true })],
];

function sum(counter: Counter, other: Counter, fast: Fast, change: () => void): string {
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) change();
    a = counter.next(a) % 100003;
    b = other.next(b) % 100003;
    c = fast.skip(c) % 100003;
    d = counter.twice(d) % 100003;
  }
  return a + " " + b + " " + c + " " + d;
}

for (const [title, change] of changes) {
  const counter = new Counter(1), other = new Counter(2), fast = new Fast(3);
  console.log(title);
  console.log("  before", sum(counter, other, fast, () => {}));
  console.log("  during", sum(counter, other, fast, () => { change(counter, from => from + 7); }));
  console.log("  after", sum(counter, other, fast, () => {}));
  console.log("  a subclass", sum(counter, other, fast, () => { change(fast, from => from + 11); }));
  console.log("  keys", Object.keys(counter).join(), Object.keys(other).join(), Object.keys(fast).join());
  delete (counter as { next?: unknown }).next;
  console.log("  deleted", sum(counter, other, fast, () => {}));
}
