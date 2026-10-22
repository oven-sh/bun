// Function declarations are listed as members of a literal that stands behind a branch, in a loop, or behind a call that may throw. One declaration gives one function object for each activation.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

interface Counter {
  get(): number;
  step(): void;
  reset(): void;
  twice(): void;
  never(): string;
}
function make(start: number, text?: string): Counter {
  let pos = start;
  let end = text === undefined ? 0 : text.length;
  const counter: Counter = {
    get: () => pos + end,
    step,
    reset,
    twice,
    never,
  };
  return counter;
  function step() {
    pos++;
  }
  function reset() {
    pos = 0;
    end = 0;
  }
  // A sibling calls `step`, so that one has two uses.
  function twice() {
    step();
    step();
  }
  function never() {
    return "never " + pos;
  }
}
let sum = 0;
const kept: Counter[] = [];
for (let i = 0; i < 300; i++) {
  const counter = make(i, i % 2 ? "ab" : undefined);
  counter.step();
  if (i % 3 === 0) counter.twice();
  if (i % 50 === 0) counter.reset();
  sum += counter.get();
  if (i % 60 === 0) kept.push(counter);
}
say("sum", sum, kept.map(counter => counter.never()).join(), kept[0].step === kept[0].step, kept[0].step !== kept[1].step, kept[0].never !== kept[1].never, Object.keys(kept[0]).join());

// The literal stands in a loop behind the declarations: every object of one activation holds the same function objects.
interface Shared {
  index: number;
  step(): number;
  name(): string;
}
function many(count: number): Shared[] {
  let steps = 0;
  const made: Shared[] = [];
  for (let index = 0; index < count; index++) made.push({ index, step, name });
  return made;
  function step() {
    return ++steps;
  }
  function name() {
    return "shared by " + count;
  }
}
const first = many(3);
const second = many(2);
say("loop", first[0].step === first[1].step, first[1].name === first[2].name, first[0].step !== second[0].step, first[0].step(), first[2].step(), second[1].step(), first[1].name(), second[0].name());

// The literal is made on one path only, twice on another, and behind a call that throws.
function paths(kind: number): unknown[] {
  let calls = 0;
  if (kind === 0) return [typeof tick];
  if (kind === 1) {
    const one = { tick };
    return [one.tick(), one.tick === tick];
  }
  if (kind === 2) {
    const left = { tick };
    const right = { tick };
    return [left.tick === right.tick, left.tick(), right.tick()];
  }
  try {
    fail();
    return [{ tick }.tick()];
  } catch {
    const after = { tick };
    return ["caught", after.tick(), after.tick === tick];
  }
  function tick() {
    return ++calls;
  }
  function fail() {
    throw new Error("no");
  }
}
for (let kind = 0; kind < 4; kind++) say("paths", kind, paths(kind).join());

// The function object is taken from the object and from the name.
function both(flag: boolean) {
  let value = 1;
  const holder = flag ? { read, write } : { read, write, extra: 1 };
  return { holder, sameRead: holder.read === read, write };
  function read() {
    return value;
  }
  function write(next: number) {
    value = next;
  }
}
for (const flag of [true, false]) {
  const made = both(flag);
  made.write(7);
  say("both", flag, made.sameRead, made.holder.write === made.write, made.holder.read(), Object.keys(made.holder).join());
}

console.log(lines.join("\n"));
