function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

type Numbers = Generator<number, string, number>;

class Pretender extends Iterator<number, string, number> {
  at = 0;
  heard: string[] = [];
  next(...sent: [] | [number]): IteratorResult<number, string> {
    this.heard.push("next " + sent.length + " " + text(sent[0]));
    this.at++;
    return this.at > 3 ? { done: true, value: "pretended end" } : { done: false, value: this.at * 100 };
  }
  return(value: string): IteratorResult<number, string> {
    this.heard.push("return " + text(value));
    this.at = 99;
    return { done: true, value: "pretended " + value };
  }
  throw(error: unknown): IteratorResult<number, string> {
    this.heard.push("throw " + text(error));
    return { done: false, value: -1 };
  }
  [Symbol.iterator](): this {
    this.heard.push("iterator");
    return this;
  }
}

function* real(): Numbers {
  let sum = 0;
  for (let i = 1; i <= 3; i++) sum += yield i * 100;
  return "real end " + sum;
}

function drain(g: Numbers): string {
  const out: string[] = [];
  let result = g.next(0);
  while (!result.done) {
    out.push(String(result.value));
    result = g.next(1);
  }
  return out.join() + " " + result.value + " " + result.value.length;
}

function closeIt(g: Numbers): string {
  g.next(0);
  return text(g.return("closed")) + " " + text(g.next(1));
}

function upset(g: Numbers): string {
  g.next(0);
  try {
    return text(g.throw("upset"));
  } catch (error) {
    return failure(error);
  }
}

function* through(g: Numbers): Numbers {
  const end: string = yield* g;
  return "through: " + end;
}

function looped(g: Generator<number, string, undefined | number>): number {
  let sum = 0;
  for (const n of g) sum += n;
  return sum;
}

class Shelf {
  kept: Numbers;
  all: Numbers[] = [];
  constructor(kept: Numbers) {
    this.kept = kept;
    this.all.push(kept);
  }
  step(): string {
    return text(this.kept.next(5)) + " " + text(this.all[0].next(6));
  }
}

const makers: [string, () => Numbers][] = [
  ["real", real],
  ["pretender", () => new Pretender()],
];

let warm = "";
for (let i = 0; i < 2000; i++) warm = drain(real());
console.log("2000 real ones: " + warm);

for (const [label, make] of makers) {
  console.log(label + ", drain: " + drain(make()));
  console.log(label + ", close: " + closeIt(make()));
  console.log(label + ", upset: " + upset(make()));
  console.log(label + ", through yield*: " + drain(through(make())));
  console.log(label + ", for-of: " + looped(make()));
  console.log(label + ", spread by way of an iterable: " + text(Array.from(make())));
  console.log(label + ", on a shelf: " + new Shelf(make()).step());
  console.log(label + ", helper: " + text(make().map(n => n + 1).toArray()));
  console.log(label + ", tag: " + Object.prototype.toString.call(make()));
  console.log(label + ", instanceof Iterator: " + (make() instanceof Iterator));
  console.log(label + ", keys: " + Object.keys(make()).join());
}

const watched = new Pretender();
const asGenerator: Numbers = watched;
drain(through(asGenerator));
console.log("heard: " + watched.heard.join(" | "));
console.log("real again: " + drain(real()));

export {};
