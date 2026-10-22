// Methods found through instances: Array.from, Set, Map, Promise.all, Object.fromEntries and a spread call next without an argument, and return without one where they stop early; the program's own calls pass numbers.
export {};

let total = 0;

class Countdown implements Iterator<number> {
  constructor(public left: number) {}
  [Symbol.iterator](): this {
    return this;
  }
  next(step: number): IteratorResult<number> {
    total += typeof step === "number" ? 1 : step === undefined ? 100 : 10000;
    this.left -= typeof step === "number" ? step : 1;
    return this.left >= 0 ? { done: false, value: this.left } : { done: true, value: undefined };
  }
  return(code: number): IteratorResult<number> {
    total += typeof code === "number" ? 100000 : code === undefined ? 1000000 : 10000000;
    return { done: true, value: undefined };
  }
}

const own = new Countdown(5);
own.next(2);
own.return(0);
const counts: number[] = [Array.from(new Countdown(2) as any).length, new Set(new Countdown(3) as any).size, Math.max(...(new Countdown(4) as any))];
counts.push((await Promise.all(new Countdown(2) as any)).length);
for (const attempt of [() => new Map(new Countdown(3) as any), () => Object.fromEntries(new Countdown(3) as any), () => Array.from(new Countdown(3) as any, () => { throw 1; })]) {
  try {
    attempt();
  } catch {
    counts.push(-1);
  }
}
const [first] = new Countdown(9) as any;
console.log(total, counts.join(), first);
