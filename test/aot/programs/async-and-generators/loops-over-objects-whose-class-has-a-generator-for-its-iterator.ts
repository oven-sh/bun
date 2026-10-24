class Span {
  constructor(
    public from: number,
    public to: number,
  ) {}
  *[Symbol.iterator]() {
    for (let k = this.from; k < this.to; k++) yield k;
  }
  *values() {
    for (let k = this.from; k < this.to; k++) yield k * 2;
  }
  *failing(): Generator<number> {
    yield this.from;
    throw new Error("from the body");
  }
}

class Wider extends Span {
  *[Symbol.iterator]() {
    yield -1;
    yield* super[Symbol.iterator]();
  }
}

function sum(span: Span): number {
  let total = 0;
  for (const value of span) total += value;
  return total;
}

function sumOfNew(i: number): number {
  let total = 0;
  for (const value of new Span(i & 3, 8)) total += value;
  return total;
}

function leftEarly(i: number): number {
  let total = 0;
  for (const value of new Span(0, 100)) {
    if (value > i) break;
    total += value;
  }
  return total;
}

const lines: unknown[] = [];
let check = 0;
for (let i = 0; i < 2000; i++) check = (check + sumOfNew(i) + sum(new Span(i & 1, 5)) + sum(new Wider(1, 4)) + leftEarly(i & 7)) | 0;
lines.push(check);

const span = new Span(1, 4);
lines.push(span[Symbol.iterator] === Span.prototype[Symbol.iterator], span.values === Span.prototype.values);
const made = span.values();
lines.push(Object.getPrototypeOf(made) === Span.prototype.values.prototype, Object.getPrototypeOf(span[Symbol.iterator]()) === Span.prototype[Symbol.iterator].prototype);
lines.push(made[Symbol.iterator]() === made, [...made], [...span], Array.from(new Wider(2, 4)));
const [first, second, ...rest] = new Span(5, 9);
lines.push(first, second, rest);

(Span.prototype.values.prototype as any).label = "of values";
lines.push((span.values() as any).label, (span[Symbol.iterator]() as any).label);

function traced(): string {
  try {
    for (const value of new Span(1, 2).failing()) check += value;
  } catch (error) {
    return (error as Error).stack!.split("\n").slice(0, 3).map(line => line.replace(/\(.*[\\/]/, "(").trim()).join(" | ");
  }
  return "nothing thrown";
}
lines.push(traced());

class Bag {
  constructor(public size: number) {}
  *values(): Generator<number> {
    for (let k = 0; k < this.size; k++) {
      if (k === 5) throw new Error("at the sixth");
      yield k;
    }
  }
  [Symbol.iterator]() {
    return this.values();
  }
}
function sumOfBag(size: number): number | string {
  let total = 0;
  try {
    for (const value of new Bag(size)) total += value;
  } catch (error) {
    return (error as Error).stack!.split("\n").slice(0, 3).map(line => line.replace(/\(.*[\\/]/, "(").trim()).join(" | ");
  }
  return total;
}
for (let i = 0; i < 2000; i++) check = (check + (sumOfBag(i & 3) as number)) | 0;
lines.push(check, sumOfBag(4), sumOfBag(9));

function stepped(size: number): number | string {
  const steps = new Bag(size).values();
  let total = 0;
  try {
    for (let step = steps.next(); !step.done; step = steps.next()) total += step.value;
  } catch (error) {
    return (error as Error).stack!.split("\n").slice(0, 3).map(line => line.replace(/\(.*[\\/]/, "(").trim()).join(" | ");
  }
  return total;
}
for (let i = 0; i < 2000; i++) check = (check + (stepped(i & 3) as number)) | 0;
lines.push(check, stepped(4), stepped(9));

console.log(JSON.stringify(lines));
