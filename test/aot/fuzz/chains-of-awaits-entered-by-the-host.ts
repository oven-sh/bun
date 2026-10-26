// Chains of async functions that await each other and mostly wait for nothing, entered from a callback of the host: setImmediate, a timer, a tick, a microtask, a promise handler, an event,
// a message. Between two functions of a chain lies a link: a call by name, a call of a value from an array, a closure or a bound function handed on as `next`, a plain function that
// returns the call, Promise.resolve() around it, then() behind it, a try block, or a promise that is kept in a variable while other code runs. Around its await each function may queue a microtask, a tick,
// a handler, a timer; throw; await a settled promise, a pending one, a thenable with a getter, a promise of a subclass, a step of an async generator; read the store of AsyncLocalStorage; take a stack trace.
// Behind the call of the chain the callback may go on with code of its own. Every step writes down its number: the program prints the order, which is that of plain Bun.
import type { Random } from "./random";

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = as("any");
  let next = 0;
  const label = () => `"${next++}"`;

  // Something that a function does beside its await. It never waits.
  const aside = (): string =>
    random.weighted([
      [6, () => `note(${label()});`],
      [3, () => `queueMicrotask(() => note(${label()}));`],
      [3, () => `process.nextTick(() => note(${label()}));`],
      [3, () => `settled.then(() => note(${label()}));`],
      [1, () => `setImmediate(() => note(${label()}));`],
      [2, () => `note(${label()}, store.getStore());`],
      [2, () => `note(${label()}, frames());`],
      [1, () => `void Promise.reject(new Error(${label()})).catch(error => note(${label()}, error.message));`],
      [1, () => `emitter.emit("aside", ${label()});`],
    ])();
  const asides = (most: number) => Array.from({ length: random.below(most + 1) }, aside).join(" ");

  // An await of something other than the next function of the chain.
  const otherAwait = (): string =>
    random.weighted([
      [4, () => `await settled;`],
      [3, () => `await ${random.between(0, 9)};`],
      [2, () => `await undefined;`],
      [2, () => `note(${label()}, await thenable(${label()}));`],
      [2, () => `note(${label()}, await new Sub(resolve => resolve(${random.between(1, 9)})));`],
      [2, () => `await later();`],
      [1, () => `note(${label()}, (await steps.next()).value);`],
      [1, () => `for await (const step of few()) note(${label()}, step);`],
      [1, () => `await Promise.all([settled, ${random.between(1, 9)}]);`],
      [
        1,
        () =>
          `try { await Promise.reject(new Error(${label()})); } catch (error${any}) { note(${label()}, error.message); }`,
      ],
      [
        1,
        () =>
          `await store.run(${label()}, async () => { note(${label()}, store.getStore()); await settled; note(${label()}, store.getStore()); });`,
      ],
    ])();

  const depth = random.between(2, 7);
  const functions: string[] = [];
  const name = (level: number) => `level${level}`;
  // How level n reaches level n + 1. `call` is the expression whose value is awaited.
  const link = (level: number): { before: string; call: string } => {
    const callee = name(level + 1);
    return random.weighted([
      [5, () => ({ before: "", call: `${callee}(n + 1)` })],
      [3, () => ({ before: "", call: `table[${level + 1}](n + 1)` })],
      [3, () => ({ before: `const next = () => ${callee}(n + 1);`, call: `next()` })],
      [3, () => ({ before: `const next = ${callee}.bind(null, n + 1);`, call: `next()` })],
      [3, () => ({ before: "", call: `passOn(${callee}, n + 1)` })],
      [3, () => ({ before: "", call: `resolved(${callee}, n + 1)` })],
      [2, () => ({ before: "", call: `Promise.resolve(${callee}(n + 1))` })],
      [2, () => ({ before: "", call: `${callee}(n + 1).then(value => (note(${label()}, value), value))` })],
      [2, () => ({ before: `const kept = ${callee}(n + 1); ${aside()}`, call: `kept` })],
      [1, () => ({ before: "", call: `noted(${callee}, n + 1, ${label()})` })],
      [1, () => ({ before: "", call: `store.run(${label()}, ${callee}, n + 1)` })],
    ])();
  };

  for (let level = 0; level < depth; level++) {
    const last = level === depth - 1;
    const lines: string[] = [`note(${label()}, n);`, asides(2)];
    if (random.chance(0.2)) lines.push(otherAwait(), asides(1));
    if (last) {
      lines.push(
        random.weighted([
          [5, () => `return n;`],
          [2, () => `${otherAwait()} return n;`],
          [1, () => `throw new Error(${label()});`],
          [1, () => `return settled;`],
          [1, () => `return thenable(${label()});`],
        ])(),
      );
    } else {
      const { before, call } = link(level);
      const awaits = `${before} const value${any} = await ${call}; note(${label()}, value);`;
      lines.push(
        random.chance(0.3)
          ? `let result${any} = -1; try { ${awaits} result = value; } catch (error${any}) { note(${label()}, error.message); }`
          : `${awaits} const result${any} = value;`,
      );
      lines.push(asides(2));
      if (random.chance(0.15)) lines.push(otherAwait(), asides(1));
      lines.push(random.chance(0.85) ? `return result;` : `return ${name(level + 1)}(n + 100);`);
    }
    // Now and then a level is no async function: it hands on what it called.
    const plain = !last && level > 0 && random.chance(0.12);
    functions.push(
      plain
        ? `function ${name(level)}(n${as("number")})${any} { note(${label()}, n); ${asides(1)} return ${name(level + 1)}(n + 1); }`
        : `async function ${name(level)}(n${as("number")})${as("Promise<any>")} { ${lines.filter(Boolean).join(" ")} }`,
    );
  }

  // What the callback of the host does with the chain.
  const use = (): string =>
    random.weighted([
      [5, () => `return level0(0);`],
      [3, () => `return level0(0).then(value => note(${label()}, value), error => note(${label()}, error.message));`],
      [
        2,
        () =>
          `level0(0).then(value => note(${label()}, value)).catch(error => note(${label()}, error.message)); ${asides(2)}`,
      ],
      [2, () => `const chain = level0(0); ${asides(2)} return chain.catch(error => note(${label()}, error.message));`],
      [1, () => `${asides(2)} return passOn(level0, 0);`],
      [1, () => `void level0(0).catch(() => {}); return level0(50).catch(() => {});`],
    ])();

  const entries = [
    `setImmediate(enter)`,
    `setTimeout(enter, 0)`,
    `process.nextTick(enter)`,
    `queueMicrotask(enter)`,
    `settled.then(enter)`,
    `emitter.once("enter", enter); setImmediate(() => emitter.emit("enter"))`,
    `setImmediate(() => { enter(); note(${label()}); })`,
    `setImmediate(() => store.run(${label()}, enter))`,
    `channel.port1.postMessage(0)`,
  ];
  const entry = random.pick(entries);
  const rounds = random.pick([1, 2, 3, 40]);

  return `import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
const log${as("string[]")} = [];
function note(step${as("string")}, value${typed ? "?: any" : ""}) {
  log.push(value === undefined ? step : step + "=" + String(value));
}
const store = new AsyncLocalStorage${typed ? "<string>" : ""}();
const emitter = new EventEmitter();
emitter.on("aside", step => note(step));
const settled = Promise.resolve(0);
// The first tick of a process sets up the queue of ticks.
process.nextTick(() => {});
await settled;
class Sub${typed ? "<T>" : ""} extends Promise${typed ? "<T>" : ""} {}
function thenable(step${as("string")})${any} {
  return {
    get then() {
      note(step + "g");
      return (resolve${as("(value: number) => void")}) => {
        note(step + "t");
        resolve(5);
      };
    },
  };
}
function later() {
  return new Promise${typed ? "<void>" : ""}(resolve => setImmediate(resolve));
}
async function* few() {
  yield 1;
  yield 2;
}
async function* forever() {
  for (let i = 0; ; i++) yield i;
}
const steps = forever();
// The names of the functions of this file on the stack, and which of them are there as async callers.
function frames() {
  return (new Error().stack ?? "")
    .split("\\n")
    .map(line => /at (async )?(level\\d+|enter|passOn|resolved|noted)\\b/.exec(line))
    .filter(match => match !== null)
    .map(match => (match${typed ? "!" : ""}[1] ? "~" : "") + match${typed ? "!" : ""}[2])
    .join(",");
}
function passOn(callee${as("(n: number) => any")}, n${as("number")}) {
  return callee(n);
}
function resolved(callee${as("(n: number) => any")}, n${as("number")}) {
  try {
    return Promise.resolve(callee(n));
  } catch (error) {
    return Promise.reject(error);
  }
}
function noted(callee${as("(n: number) => any")}, n${as("number")}, step${as("string")}) {
  const result = callee(n);
  note(step);
  return result;
}
${functions.reverse().join("\n")}
const table${as("((n: number) => any)[]")} = [${Array.from({ length: depth }, (_, level) => name(level)).join(", ")}];
const channel = new MessageChannel();
let round = 0;
const orders = new Map${typed ? "<string, number>" : ""}();
function enter()${any} {
  ${use()}
}
channel.port2.onmessage = () => enter();
process.on("unhandledRejection", error => note("unhandled", (error${typed ? " as Error" : ""}).message));
for (; round < ${rounds}; round++) {
  log.length = 0;
  ${entry};
  // Long enough for everything that the round has queued.
  for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setTimeout(resolve, 0));
  const order = log.join(" ");
  orders.set(order, (orders.get(order) ?? 0) + 1);
}
channel.port1.close();
for (const [order, times] of orders) console.log(times, order);
`;
}
