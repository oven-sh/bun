// Errors and rejections that nobody catches, one after the other, and real work behind each: what leaves compiled code through the event loop must leave nothing behind.
//
//   thrown    errors, subclasses, errors with a cause, AggregateError, numbers, texts, null, undefined, plain objects, symbols, frozen errors, proxies, objects that cannot be put into words, errors whose stack is an accessor, functions, big integers
//   where     Promise.reject, async functions ahead of and behind an await, in a finally, handlers, executors, thenables, Promise.all, race and any, async generators, for await, rejections caught late or just in time;
//             timers, microtasks, ticks, listeners, "error" events without a listener, listeners of an EventTarget, many frames down with a finally in each, callbacks of built-ins, generators, disposers, the end of the stack
//   heard by  nobody, process.on("unhandledRejection"), process.on("uncaughtException"), both; handlers that throw, that end the process, that set the exit code; "rejectionHandled", "beforeExit" and "exit", which work too
//   meanwhile async functions and generators wait in a try with a finally that must not run
//
// Every timer waits as long as every other, so that they run in the order in which they were set. Whether two of them run in one turn of the event loop hangs on the clock, and with it when a rejection is reported:
// what the handlers hear is printed at the exit, sorted. What the program prints and its exit code are compared. The report of an uncaught error goes to stderr and is not.
import type { Random } from "./random";
import { callbacks, prelude, probes } from "./work-on-the-way-up";

const beside = `let finals = 0;
let reads = 0;
let lateCatches = 0;
let handledLate = 0;
const whatWasHeard: string[] = [];
function noteHeard(...parts: unknown[]): void {
  whatWasHeard.push(parts.map(String).join(" "));
}
function turn(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 1));
}
function describe(value: unknown): string {
  try {
    // The message of an "error" event that nobody hears holds the whole thing that was sent, with its stack.
    if (value instanceof Error) return value.name + " " + value.message.split("\\n")[0] + (value.cause === undefined ? "" : " < " + describe(value.cause)) + (value instanceof AggregateError ? " [" + value.errors.map(describe).join() + "]" : "");
    return typeof value + " " + String(value);
  } catch {
    return typeof value + " that cannot be put into words";
  }
}
function fall(depth: number, value: () => unknown): number {
  const held = [depth];
  try {
    if (depth === 0) throw value();
    return fall(depth - 1, value) + held[0];
  } finally {
    finals++;
  }
}
function forever(n: number): number {
  return forever(n + 1) + 1;
}
async function waitsForever(id: number): Promise<void> {
  const held = { id };
  try {
    await new Promise(nothing);
  } finally {
    console.log("a finally ran that must not", held.id);
  }
}
function* paused(id: number): Generator<number, void, unknown> {
  try {
    yield id;
    yield id + 1;
  } finally {
    console.log("a finally of a generator ran that must not", id);
  }
}
`;

const values: readonly string[] = [
  `new Failure(N)`,
  `new Failure(N)`,
  `new TypeError("t" + N)`,
  `new Error("outer", { cause: new Failure(N) })`,
  `new AggregateError([new Failure(N), N], "many")`,
  `N`,
  `"text" + N`,
  `null`,
  `undefined`,
  `{ plain: N }`,
  `Symbol("s" + N)`,
  `Object.freeze(new Failure(N))`,
  `new Proxy(new Failure(N), {})`,
  `{ toString() { throw new Failure(N); } }`,
  `Object.create(null)`,
  `Object.defineProperty(new Failure(N), "stack", { get() { reads++; return "s"; } })`,
  `Object.defineProperty(new Failure(N), "message", { get() { reads++; return "m"; } })`,
  `function thrown() {}`,
  `new Point(N, 1)`,
  `[N, N]`,
  `BigInt(N)`,
];

// `V` stands for the value.
const roads: readonly (readonly [name: string, statement: string])[] = [
  ["promise-reject", `void Promise.reject(V);`],
  ["an-async-function", `void (async () => { throw V; })();`],
  ["behind-an-await", `void (async () => { await null; throw V; })();`],
  ["behind-a-turn", `void (async () => { await turn(); throw V; })();`],
  ["in-a-finally-of-an-async-function", `void (async () => { try { await null; } finally { finals++; throw V; } })();`],
  ["through-async-functions", `void (async () => { const inner = async () => { await null; throw V; }; try { await inner(); } finally { finals++; } })();`],
  ["a-handler", `void Promise.resolve().then(() => { throw V; });`],
  ["through-finally", `void Promise.reject(V).finally(() => { finals++; });`],
  ["promise-all", `void Promise.all([soon(1), Promise.reject(V)]);`],
  ["promise-race", `void Promise.race([turn(), Promise.reject(V)]);`],
  ["promise-any", `void Promise.any([Promise.reject(V), Promise.reject(1)]);`],
  ["reject-in-an-executor", `void new Promise((_resolve, reject) => reject(V));`],
  ["an-executor-throws", `void new Promise(() => { throw V; });`],
  ["an-executor-throws-too-late", `void new Promise<void>(resolve => { resolve(); throw V; });`],
  ["a-thenable", `void Promise.resolve({ then() { throw V; } });`],
  ["an-async-generator", `void (async function* () { throw V; })().next();`],
  ["for-await", `void (async () => { for await (const each of [soon(1), Promise.reject(V)]) finals += each; })();`],
  ["caught-late", `{ const late = Promise.reject(V); setTimeout(() => setTimeout(() => void late.catch(() => { lateCatches++; }), 1), 1); }`],
  ["caught-just-in-time", `{ const late = Promise.reject(V); queueMicrotask(() => void late.catch(() => { lateCatches++; })); }`],
  ["caught-a-tick-later", `{ const late = Promise.reject(V); process.nextTick(() => void late.catch(() => { lateCatches++; })); }`],
  ["a-timer", `setTimeout(() => { throw V; }, 1);`],
  ["a-microtask", `queueMicrotask(() => { throw V; });`],
  ["a-tick", `process.nextTick(() => { throw V; });`],
  ["an-error-event", `setTimeout(() => void new EventEmitter().emit("error", V), 1);`],
  ["a-listener", `{ const local = new EventEmitter(); local.on("e", () => { throw V; }); setTimeout(() => void local.emit("e"), 1); }`],
  ["a-listener-of-an-event-target", `{ const target = new EventTarget(); target.addEventListener("e", () => { throw V; }); target.dispatchEvent(new Event("e")); }`],
  ["many-frames-down", `setTimeout(() => void fall(30, () => V), 1);`],
  ["many-frames-down-in-a-handler", `void Promise.resolve().then(() => fall(30, () => V));`],
  ["a-callback-of-map", `setTimeout(() => void [1].map(() => { throw V; }), 1);`],
  ["a-comparer", `setTimeout(() => void [2, 1].sort(() => { throw V; }), 1);`],
  ["a-replacer", `setTimeout(() => void "a".replace(/a/, () => { throw V; }), 1);`],
  ["a-reviver", `setTimeout(() => void JSON.parse("[1]", () => { throw V; }), 1);`],
  ["a-getter-read-by-a-built-in", `setTimeout(() => void Object.assign({}, { get a() { throw V; } }), 1);`],
  ["a-trap", `setTimeout(() => void Reflect.get(new Proxy({}, { get() { throw V; } }), "a"), 1);`],
  ["to-string", `setTimeout(() => void \`\${{ toString() { throw V; } }}\`, 1);`],
  ["thrown-into-a-generator", `setTimeout(() => { const generator = upTo(3); generator.next(); generator.throw(V); }, 1);`],
  ["a-disposer", `setTimeout(() => { using _resource = { [Symbol.dispose]() { throw V; } }; finals++; }, 1);`],
  ["a-constructor", `setTimeout(() => void new (class { field = fall(2, () => V); })(), 1);`],
  ["the-end-of-the-stack", `setTimeout(() => void forever(0), 1);`],
  ["the-end-of-the-stack-in-a-handler", `void Promise.resolve().then(() => forever(0));`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude.replace('process.on("unhandledRejection", nothing);\n', ""), beside];
  const used = [...random.sample(callbacks, random.between(1, 2)), ...random.sample(probes, random.between(1, 2))];
  used.forEach(([, body], at) => text.push(`function probe${at}(): unknown {\n  ${body}\n}`));
  text.push(`const expected = [${used.map((_, at) => `probe${at}()`).join(", ")}];
function works(): string {
  return [${used.map((_, at) => `probe${at}()`).join(", ")}].every((answer, at) => answer === expected[at]) ? "works" : "DOES NOT WORK";
}`);
  const hears = pick(["nobody", "rejections", "rejections", "exceptions", "both", "both", "both"]);
  const twist = (name: string) =>
    pick([
      "",
      "",
      "",
      "",
      `\n  if (heard${name} === ${random.between(1, 3)}) throw new Failure(1000);`,
      `\n  if (heard${name} === ${random.between(1, 4)}) process.exit(${random.between(0, 3)});`,
      `\n  if (heard${name} === ${random.between(1, 3)}) process.exitCode = ${random.between(2, 9)};`,
      `\n  if (heard${name} === ${random.between(1, 3)}) void Promise.reject(new Failure(2000));`,
      `\n  if (heard${name} === ${random.between(1, 3)}) process.removeAllListeners("${name === "Rejections" ? "unhandledRejection" : "uncaughtException"}");`,
    ]);
  const names: string[] = ["heard-by-" + hears];
  if (hears === "rejections" || hears === "both") text.push(`let heardRejections = 0;\nprocess.on("unhandledRejection", (reason: unknown, promise: unknown) => {\n  heardRejections++;\n  noteHeard("unhandled", describe(reason), promise instanceof Promise, works());${twist("Rejections")}\n});`);
  if (hears === "exceptions" || hears === "both") text.push(`let heardExceptions = 0;\nprocess.on("uncaughtException", (error: unknown, origin: unknown) => {\n  heardExceptions++;\n  noteHeard("uncaught", describe(error), origin, works());${twist("Exceptions")}\n});`);
  if (random.chance(0.5)) text.push(`process.on("rejectionHandled", (promise: unknown) => void (promise instanceof Promise && handledLate++));`);
  if (random.chance(0.3)) text.push(`process.on("uncaughtExceptionMonitor", (error: unknown, origin: unknown) => noteHeard("monitor", describe(error), origin));`);
  text.push(`process.on("exit", (code: number) => {\n  for (const line of whatWasHeard.sort()) console.log(line);\n  console.log("exit", code, process.exitCode, works(), finals, reads > 0, lateCatches, handledLate);\n});`);
  const episodes = random.between(2, 7);
  const written = (id: number) => {
    const [name, statement] = pick(roads);
    names.push(name);
    return statement.replaceAll("V", `(${pick(values).replaceAll("N", String(id))})`);
  };
  if (random.chance(0.3)) text.push(`let before = 0;\nprocess.on("beforeExit", (code: number) => {\n  console.log("before exit", code, works());\n  if (before++ === 0) ${written(90)}\n});`);
  if (random.chance(0.6)) text.push(`void waitsForever(1);\nconst generator = paused(1);\ngenerator.next();`);
  const threeTurns = "await turn();\nawait turn();\nawait turn();";
  const isTimed = (statement: string) => statement.includes("setTimeout(");
  for (let id = 1; id <= episodes; id++) {
    const first = written(id);
    const second = random.chance(0.2) ? written(id + 50) : "";
    const wait = pick([threeTurns, threeTurns, "await null;", "", "await turn();"]);
    // Two timers that throw are never due at once: whether the second is still heard behind the first goes by the clock, in plain Bun too.
    text.push(`// ${id}\n${first}${second ? "\n" + (isTimed(first) && isTimed(second) ? threeTurns + "\n" : "") + second : ""}`);
    text.push(`${isTimed(first) || isTimed(second) ? threeTurns : wait}\nconsole.log(${id}, works());`);
  }
  const last = pick(["", "", "", `throw (${pick(values).replaceAll("N", "99")});`, `await Promise.reject(${pick(values).replaceAll("N", "99")});`, `process.exit(${random.between(0, 2)});`]);
  text.push(`console.log("the end");${last ? "\n" + last : ""}`);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
