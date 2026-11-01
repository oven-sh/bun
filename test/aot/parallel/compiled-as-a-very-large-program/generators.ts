// Flags: --aot-limit=MaxWarmCodeValues:1
// As classes.ts. Generators: what next, return and throw get, try and finally around a yield, yield*, spreading, destructuring that stops early, and async generators.
const log: string[] = [];
function* counted(name: string, to: number): Generator<number, string, number | undefined> {
  log.push(name + " begins");
  let sum = 0;
  try {
    for (let n = 1; n <= to; n++) {
      const sent = yield n;
      sum += n + (sent ?? 0);
      log.push(name + " got " + sent + ", sum " + sum);
    }
    return name + " done with " + sum;
  } catch (error) {
    log.push(name + " caught " + error);
    yield -1;
    return name + " went on";
  } finally {
    log.push(name + " cleans up at " + sum);
  }
}
function* joined(): Generator<number | string, string, number | undefined> {
  const first = yield* counted("inner", 2);
  yield first;
  yield* [10, 20];
  yield* "ab";
  return "joined";
}
function driveByHand() {
  const one = counted("one", 3);
  const show = (result: IteratorResult<number, string>) => log.push(JSON.stringify(result));
  show(one.next(100));
  show(one.next(5));
  show(one.throw("a stone"));
  show(one.next());
  show(one.next());
  const two = counted("two", 3);
  show(two.next());
  show(two.return("left early"));
  show(two.next());
  const never = counted("never", 1);
  show(never.return("before it began"));
  try {
    counted("thrown at", 1).throw(new Error("at the start"));
  } catch (error) {
    log.push("out came: " + (error as Error).message);
  }
}
function driveBySyntax() {
  log.push([...joined()].join());
  const [a, b] = counted("taken apart", 5);
  log.push("two of five: " + a + " " + b);
  for (const n of counted("broken off", 5)) {
    if (n === 2) break;
  }
  log.push(String(Math.max(...counted("spread", 3))));
  log.push(JSON.stringify(Object.fromEntries(new Map([...counted("keys", 2)].map(n => ["k" + n, n * n])))));
  const lazy = {
    *[Symbol.iterator]() {
      yield* [this.from, this.from + 1];
    },
    from: 7,
  };
  log.push(Array.from(lazy, n => n * 2).join());
}
async function* ticking(to: number) {
  try {
    for (let n = 0; n < to; n++) {
      await null;
      yield n;
    }
  } finally {
    log.push("ticking stops");
  }
}
async function driveAsync() {
  let text = "";
  for await (const n of ticking(3)) text += n;
  for await (const n of ticking(9)) {
    text += "|" + n;
    if (n === 1) break;
  }
  const byHand = ticking(2);
  const results = await Promise.all([
    byHand.next(),
    byHand.next(),
    byHand.next(),
    (byHand as AsyncGenerator<number, unknown>).return("over"),
  ]);
  log.push(text + " " + JSON.stringify(results));
}
// Each is called twice from code that runs once: a function that is called once counts as one that runs.
driveByHand();
driveBySyntax();
await driveAsync();
driveByHand();
driveBySyntax();
await driveAsync();
console.log(log.join("\n"));
