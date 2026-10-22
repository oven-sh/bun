export {};

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

(globalThis as any).note = (text: string) => log.push(text);
const hidden = (text: string): any => (0, eval)("(" + text + ")");

const lines: string[] = [];

async function attemptAsync(label: string, run: () => Promise<unknown>): Promise<void> {
  log.length = 0;
  try {
    console.log(label, "->", show(await run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

async function halfLater(n: number): Promise<number> {
  await null;
  return n / 2;
}

async function halfOfPromise(p: Promise<number>): Promise<number> {
  const n: number = await p;
  return n / 2;
}

async function keptAcross(list: number[]): Promise<number> {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += list[i];
    await null;
  }
  return sum;
}

async function sumOfAll(ps: Promise<number>[]): Promise<number> {
  let sum = 0;
  for (const n of await Promise.all(ps)) sum += n;
  return sum;
}

async function overAsync(source: AsyncIterable<number>): Promise<number> {
  let sum = 0;
  for await (const n of source) sum += n;
  return sum;
}

function* doubled(list: number[]): Generator<number, number, number> {
  let sent = 0;
  for (const n of list) sent += yield n * 2;
  return sent;
}

function drive(g: Generator<number, number, number>, send: number): unknown[] {
  const seen: unknown[] = [];
  let step = g.next();
  while (!step.done) {
    seen.push(step.value);
    step = g.next(send);
  }
  seen.push(step.value);
  return seen;
}

function* countTo(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

async function honest(label: string): Promise<void> {
  console.log(label, await halfLater(3), await halfOfPromise(Promise.resolve(5)), await keptAcross([1, 2]), await sumOfAll([Promise.resolve(1), halfLater(4)]), show(drive(doubled([1, 2]), 3)), show([...countTo(3)]));
}

await honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += (await halfLater(i)) + (await halfOfPromise(Promise.resolve(i))) + drive(doubled([i]), 1).length;
console.log("2000 honest rounds", warm);

for (const text of ["3", "'3'", "3n", "-0", "null", "undefined", "{ valueOf() { note('valueOf'); return 3; } }", "Promise.resolve(3)", "{ then(resolve) { note('then'); resolve(3); } }"]) {
  await attemptAsync("halfLater " + text, () => halfLater(hidden(text)));
  await attemptAsync("halfOfPromise " + text, () => halfOfPromise(hidden(text)));
  await attemptAsync("halfOfPromise resolved with " + text, () => halfOfPromise(Promise.resolve(hidden(text))));
  await attemptAsync("sumOfAll " + text, () => sumOfAll([Promise.resolve(1), hidden(text)]));
  attempt("generator sent " + text, () => drive(doubled([1, 2]), hidden(text)));
  attempt("countTo " + text, () => [...countTo(hidden(text))]);
}

for (const text of ["{ then(resolve, reject) { reject(new RangeError('no')); } }", "{ then() { throw new RangeError('no'); } }", "{ get then() { note('get-then'); return undefined; } }", "{ then: 5 }", "{ then(resolve) { resolve('first'); resolve(2); } }", "Promise.reject('rejected')", "new (class extends Promise { then(a, b) { note('own-then'); return super.then(a, b); } })(r => r('8'))"]) {
  await attemptAsync("halfOfPromise " + text, () => halfOfPromise(hidden(text)));
}

for (const text of ["[1, 2]", "[1, '2']", "[1, , 3]", "'12'", "{ length: 2, 0: 1, 1: 2 }", "new Uint8Array([1, 2])", "new Set([1, 2])", "null"]) {
  await attemptAsync("keptAcross " + text, () => keptAcross(hidden(text)));
  attempt("doubled " + text, () => drive(doubled(hidden(text)), 1));
}

await attemptAsync("changed across an await", async () => {
  const list: number[] = [1, 2, 3];
  const running = keptAcross(list);
  (list as any)[2] = "three";
  return running;
});
await attemptAsync("shortened across an await", async () => {
  const list: number[] = [1, 2, 3];
  const running = keptAcross(list);
  list.length = 1;
  return running;
});

for (const text of ["(async function* () { yield 1; yield '2'; })()", "[1, 2]", "[Promise.resolve(1), '2']", "'12'", "{ [Symbol.asyncIterator]() { let n = 0; return { next() { return { done: n++ > 1, value: 'v' }; } }; } }", "{ [Symbol.asyncIterator]() { return { next() { return 5; } }; } }", "null", "{}"]) {
  await attemptAsync("for await " + text, () => overAsync(hidden(text)));
}

attempt("an impostor generator object", () => drive(hidden("{ n: 0, next(v) { return { done: this.n++ > 1, value: String(v) }; } }"), 4));
attempt("a generator resumed with nothing", () => {
  const g = doubled([1, 2]);
  return [g.next().value, (g as any).next().value, (g as any).next().value];
});
attempt("a generator returned early", () => {
  const g = doubled([1, 2]);
  g.next();
  return [g.return(hidden("'early'")).value, g.next(1).done];
});

await honest("honest after");
for (const line of lines) console.log(line);
