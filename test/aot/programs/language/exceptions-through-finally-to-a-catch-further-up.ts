// A value thrown through `finally` blocks, closing iterators and `using` declarations to a `catch` further up arrives unchanged, whoever threw it and whatever the blocks on the way do.
const collect: (sync: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
const log: string[] = [];
const anything: any = { json: JSON };
function raise(value: unknown): never {
  throw value;
}
function hostThrows(): number {
  return anything.json.parse("{").length + 1;
}
function told(value: unknown): string {
  return value instanceof Error ? value.name + ": " + value.message.slice(0, 20) : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function cleansUp(depth: number, thrower: () => number): number {
  try {
    return depth ? cleansUp(depth - 1, thrower) + 1 : thrower() + 1;
  } finally {
    log.push("f" + depth);
  }
}
function plainFrames(depth: number, thrower: () => number): number {
  return depth ? plainFrames(depth - 1, thrower) + 1 : cleansUp(2, thrower) + 1;
}
function catches(thrower: () => number): string {
  log.length = 0;
  try {
    return "returned " + plainFrames(3, thrower);
  } catch (error) {
    return told(error) + " " + log.join();
  }
}
const sentinel = { name: "sentinel" };
const throwers: Array<() => number> = [() => raise(1), () => raise(sentinel), () => raise(undefined), () => raise(new RangeError("made here")), hostThrows, () => { throw new TypeError("literal"); }];
for (const thrower of throwers) console.log(catches(thrower));

function finallyCallsAndCatches(thrower: () => number): string {
  try {
    try {
      return "returned " + thrower();
    } finally {
      try {
        plainFrames(1, () => raise("inner"));
      } catch (inner) {
        log.push("caught " + inner);
      }
    }
  } catch (error) {
    return told(error);
  }
}
function finallyThrowsAnother(thrower: () => number): string {
  try {
    try {
      return "returned " + thrower();
    } finally {
      raise("replaced");
    }
  } catch (error) {
    return told(error);
  }
}
function finallyReturns(thrower: () => number): string {
  try {
    return "returned " + thrower();
  } finally {
    return "the finally block returned";
  }
}
function finallyCollects(thrower: () => number): string {
  try {
    try {
      return "returned " + thrower();
    } finally {
      collect(true);
    }
  } catch (error) {
    return told(error);
  }
}
for (const thrower of throwers) console.log([finallyCallsAndCatches(thrower), finallyThrowsAnother(thrower), finallyReturns(thrower), finallyCollects(thrower)].join(" ; "));

function closesIterator(thrower: () => number): string {
  const iterable = {
    [Symbol.iterator]() {
      return { next: () => ({ done: false, value: 1 }), return: () => { log.push("closed"); return { done: true, value: 0 }; } };
    },
  };
  log.length = 0;
  try {
    for (const item of iterable) thrower();
    return "nothing";
  } catch (error) {
    return told(error) + " " + log.join();
  }
}
function disposes(thrower: () => number): string {
  log.length = 0;
  try {
    using resource = { [Symbol.dispose]() { log.push("disposed"); } };
    return "returned " + thrower();
  } catch (error) {
    return told(error) + " " + log.join();
  }
}
for (const thrower of throwers) console.log(closesIterator(thrower) + " ; " + disposes(thrower));

function* yieldsInFinally(thrower: () => number): Generator<string> {
  try {
    thrower();
  } finally {
    yield "suspended";
  }
}
function firstCaller(generator: Generator<string>): string {
  try {
    return generator.next().value as string;
  } catch (error) {
    return "the first caller caught " + told(error);
  }
}
function secondCaller(generator: Generator<string>): string {
  try {
    return String(generator.next().value);
  } catch (error) {
    return "the second caller caught " + told(error);
  }
}
for (const thrower of throwers) {
  const generator = yieldsInFinally(thrower);
  console.log(firstCaller(generator) + " ; " + secondCaller(generator));
}

const tick = Promise.resolve();
async function asyncCleansUp(depth: number, thrower: () => number, waits: boolean): Promise<number> {
  try {
    if (depth) return (await asyncCleansUp(depth - 1, thrower, waits)) + 1;
    if (waits) await tick;
    return thrower() + 1;
  } finally {
    if (waits) await tick;
    log.push("a" + depth);
  }
}
function startsAsync(thrower: () => number): Promise<number> | string {
  try {
    return asyncCleansUp(1, thrower, false);
  } catch (error) {
    return "thrown to the caller: " + told(error);
  }
}
async function main(): Promise<void> {
  for (const thrower of throwers) {
    for (const waits of [false, true]) {
      log.length = 0;
      try {
        console.log("returned " + (await asyncCleansUp(2, thrower, waits)));
      } catch (error) {
        console.log("async " + waits + ": " + told(error) + " " + log.join());
      }
    }
    const started = startsAsync(thrower);
    console.log(typeof started === "string" ? started : "a promise: " + (await started.catch(told)));
  }
  let count = 0;
  for (let i = 0; i < 10000; i++) {
    try {
      plainFrames(i % 3, throwers[i % throwers.length]!);
    } catch (error) {
      count++;
    }
    log.length = 0;
    if (i % 2500 === 0) collect(true);
  }
  console.log(count);
}
main();
