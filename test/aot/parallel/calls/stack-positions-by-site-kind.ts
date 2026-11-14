// One function holds every kind of site that a stack trace can name: each shows its own line and column wherever block layout moves its code, and each handler catches its own sites only.
class Holder {
  value = 1;
}
class Thrower {
  constructor() {
    throw new Error("constructor");
  }
}
const holders: Holder[] = [new Holder(), null!];
const nothing: any = JSON.parse("null");
const wrongArgument: any = JSON.parse('"text"');
const plain = { a: 1 };
const secondSourceThrows = {
  get b(): number {
    throw new Error("second source");
  },
};
const secondItemThrows: Iterable<number> = {
  [Symbol.iterator]() {
    let items = 0;
    return {
      next(): IteratorResult<number> {
        if (++items === 2) throw new Error("second item");
        return { done: false, value: items };
      },
    };
  },
};
let label = "";

function fail(message: string): never {
  throw new Error(message);
}
function innermost(fails: boolean): number {
  if (fails) throw new Error("inlined twice");
  return 1;
}
function inlined(fails: boolean): number {
  const result = innermost(fails);
  return result + 1;
}
function count(...values: number[]): number {
  return values.length;
}
function double(value: number): number {
  if (typeof value !== "number") throw new TypeError("not a number");
  return value * 2;
}
const untyped: any = double;
function throwingCallback(item: number): number {
  throw new Error("callback of map " + item);
}
function throwingReviver(key: string, value: unknown): unknown {
  throw new Error("reviver " + key);
}
function here(): string {
  const error = new Error("here");
  return error.stack!;
}

// The frames down to attempt(), without directories and messages: the language's own errors are worded differently under --aot.
// Plain Bun throws inside double() and --aot where the argument enters it, so only the frames from its caller on are the same.
function frames(stack: string): string {
  const lines = stack.split("\n").filter(line => /^\s*at /.test(line) && !line.includes("at double "));
  const end = lines.findIndex(line => line.includes("at attempt "));
  return lines
    .slice(0, end + 1)
    .map(line => line.trim().replace(/[^\s(]*[\\/]/, "").replace(/native:\d+:\d+/, "native"))
    .join(" | ");
}
function note(what: string, stack: string): void {
  console.log(label + ", " + what + ": " + frames(stack));
}
function noteError(what: string, error: unknown): void {
  note(what + " " + (error as Error).constructor.name, (error as Error).stack!);
}

function all(step: number, handler: string): number {
  const holder = holders[step === 5 ? 1 : 0];
  let total = 0;
  if (handler === "none") {
    if (step === 1) fail("plain call");
    if (step === 2) new Thrower();
    if (step === 3) total += inlined(true);
    if (step === 4) return fail("tail call");
    if (step === 5) total += holder.value;
    if (step === 6) total += nothing.property;
    if (step === 7) total += count(...secondItemThrows);
    if (step === 8) total += untyped(wrongArgument);
    if (step === 9) {
      total += [1].map(throwingCallback).length;
      throw new Error("not reached");
    }
    if (step === 10) {
      total += JSON.parse("[1]", throwingReviver);
      throw new Error("not reached");
    }
    if (step === 11) {
      const merged = {
        ...plain,
        ...secondSourceThrows,
      };
      throw new Error("not reached " + merged.a);
    }
  }
  total += untyped(step);
  if (handler === "catch with binding") {
    try {
      if (step === 1) fail("plain call");
      if (step === 2) new Thrower();
      if (step === 3) total += inlined(true);
      if (step === 4) return fail("not a tail call");
      if (step === 5) total += holder.value;
      if (step === 6) total += nothing.property;
      if (step === 7) total += count(...secondItemThrows);
      if (step === 8) total += untyped(wrongArgument);
    } catch (error) {
      noteError("caught", error);
      note("after the catch", here());
    }
  }
  total += untyped(total);
  if (handler === "catch without binding") {
    try {
      if (step === 1) fail("plain call");
      if (step === 2) new Thrower();
      if (step === 3) total += inlined(true);
      if (step === 4) return fail("not a tail call");
      if (step === 5) total += holder.value;
      if (step === 6) total += nothing.property;
      if (step === 7) total += count(...secondItemThrows);
      if (step === 8) total += untyped(wrongArgument);
    } catch {
      note("after the catch", here());
    }
  }
  total += untyped(total);
  if (handler === "finally") {
    let finished = false;
    try {
      if (step === 1) fail("plain call");
      if (step === 2) new Thrower();
      if (step === 3) total += inlined(true);
      if (step === 4) return fail("not a tail call");
      if (step === 5) total += holder.value;
      if (step === 6) total += nothing.property;
      if (step === 7) total += count(...secondItemThrows);
      if (step === 8) total += untyped(wrongArgument);
      finished = true;
    } finally {
      if (!finished) note("in finally", here());
    }
  }
  console.log(label + ": reached the end");
  return total;
}

function attempt(step: number, handler: string): void {
  label = handler + " " + step;
  try {
    const result = all(step, handler);
    console.log(label + ": returned " + result);
  } catch (error) {
    noteError("thrown", error);
    note("after the throw", here());
  }
}

for (const handler of ["none", "catch with binding", "catch without binding", "finally"]) {
  const lastStep = handler === "none" ? 11 : 8;
  for (let step = 0; step <= lastStep; step++) attempt(step, handler);
}
export {};
