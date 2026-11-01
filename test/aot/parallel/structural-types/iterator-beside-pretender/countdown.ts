function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Countdown implements IterableIterator<number> {
  left: number;
  constructor(from: number) {
    this.left = from;
  }
  next(): IteratorResult<number> {
    if (this.left <= 0) return { done: true, value: undefined };
    return { done: false, value: this.left-- };
  }
  return(): IteratorResult<number> {
    this.left = 0;
    return { done: true, value: undefined };
  }
  [Symbol.iterator](): this {
    return this;
  }
}

show("honest", () => [...new Countdown(3)].join());
show("bare next", () => {
  const { next } = new Countdown(3);
  return next().value;
});
show("next on a look-alike", () => {
  const like = { left: 2 };
  const countdown = new Countdown(9);
  return countdown.next.call(like).value + " " + like.left + " " + countdown.left;
});
show("next on a wrong look-alike", () => JSON.stringify(new Countdown(9).next.call({ left: "two" })));
show("next on an empty object", () => JSON.stringify(new Countdown(9).next.call({})));
show("an iterable made of another one's methods", () => {
  const source = new Countdown(9);
  const borrowed = { left: 2, next: source.next, [Symbol.iterator]: source[Symbol.iterator] };
  return [...borrowed].join() + " " + source.left;
});
show("an iterable whose iterator method lost its object", () => {
  const source = new Countdown(2);
  const iterate = source[Symbol.iterator];
  const broken: Iterable<number> = { [Symbol.iterator]: () => iterate() };
  return [...broken].join();
});
show("an iterator object with a bare next", () => {
  const source = new Countdown(2);
  const next = source.next;
  const broken: Iterable<number> = { [Symbol.iterator]: () => ({ next: () => next() }) };
  return [...broken].join();
});
show("an iterator object that carries next as its member", () => {
  const source = new Countdown(2);
  const carrier: Iterable<number> = { [Symbol.iterator]: () => ({ next: source.next }) };
  const seen: string[] = [];
  for (const n of carrier) {
    seen.push(String(n));
    if (seen.length === 3) break;
  }
  return seen.join() + " " + source.left;
});
show("the same with a field of its own", () => {
  const source = new Countdown(9);
  const carrier: Iterable<number> = { [Symbol.iterator]: () => ({ left: 2, next: source.next }) };
  return [...carrier].join() + " " + source.left;
});
show("break calls return on the right object", () => {
  const source = new Countdown(5);
  for (const n of source) if (n === 4) break;
  return source.left;
});
show("destructuring", () => {
  const source = new Countdown(5);
  const [a, b] = source;
  return a + " " + b + " " + source.left;
});
show("Array.from with a bare next inside", () => {
  const source = new Countdown(2);
  return Array.from({ [Symbol.iterator]: () => ({ next: source.next.bind(source) }) }).join();
});

export {};
