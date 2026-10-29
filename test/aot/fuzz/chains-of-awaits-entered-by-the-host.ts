// Chains of async functions that await each other and mostly wait for nothing, entered from a callback of the host: setImmediate, a timer, a tick, a microtask, a promise handler, an event,
// a message, a file system callback, a stream, the handler of a server, or from the body of a module. Between two functions of a chain lies a link: a call by name, a call of a value from an
// array, a closure or a bound function handed on as `next`, call | apply, a plain function that returns the call, Promise.resolve() around it, then() | finally() behind it, Promise.all | race,
// a thenable, a try block, or a promise that is kept in a variable while other code runs. A function of the chain is a declaration, an arrow function, a method or an async generator, and takes
// one parameter, many, a rest parameter or one with a default. Around its await each function may queue a microtask, a tick, a handler, a timer; run the queued jobs on the spot; load a module
// that awaits; throw; await a settled promise, a pending one, a thenable with a getter, a promise of a subclass, a step of an async generator; read or replace the store of AsyncLocalStorage;
// take a stack trace. Behind the call of the chain the callback may go on with code of its own. Every step writes down its number: the program prints the order, which is that of plain Bun.
import type { Random } from "./random";

export interface Files {
  text: string;
  /** Modules that the program loads, by file name. */
  files: Record<string, string>;
}

/** A program of one file. */
export function generate(random: Random, typed: boolean): string {
  return write(random, typed, false).text;
}

/** A program that also loads modules of its own with require() and import() while its chains run. */
export function generateWithModules(random: Random, typed: boolean): Files {
  return write(random, typed, true);
}

function write(random: Random, typed: boolean, withModules: boolean): Files {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = as("any");
  const files: Record<string, string> = {};
  let next = 0;
  const label = () => `"${next++}"`;

  // A module that awaits in its body. Whoever loads it with require() runs the queued jobs until the body has ended.
  const moduleThatAwaits = (): string => {
    const file = `awaits${Object.keys(files).length}.mjs`;
    const awaited = () =>
      random.weighted([
        [3, () => `Promise.resolve(1)`],
        [2, () => `${random.between(0, 9)}`],
        [3, () => `globalThis.chain(${random.between(200, 299)}).catch(error => error.message)`],
        [1, () => `new Promise(resolve => queueMicrotask(() => resolve(2)))`],
      ])();
    files[file] = [
      `globalThis.note(${label()});`,
      random.chance(0.5) ? `globalThis.openGate(0);` : "",
      `export const first = await ${awaited()};`,
      `globalThis.note(${label()}, first);`,
      random.chance(0.4) ? `export const second = await ${awaited()}; globalThis.note(${label()}, second);` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    return `./${file}`;
  };
  const requires = () =>
    `try { note(${label()}, Object.keys(require("${moduleThatAwaits()}")).join()); } catch (error${any}) { note(${label()}, error.name); }`;
  // Runs what is queued before it goes on.
  const drain = (): string => (withModules && random.chance(0.5) ? requires() : `drainMicrotasks(); note(${label()});`);

  // Something that a function does beside its await. It never waits.
  const aside = (): string =>
    random.weighted([
      [6, () => `note(${label()});`],
      [3, () => `queueMicrotask(() => note(${label()}));`],
      [3, () => `process.nextTick(() => note(${label()}));`],
      [3, () => `settled.then(() => note(${label()}));`],
      [1, () => `setImmediate(() => note(${label()}));`],
      [4, () => `note(${label()}, store.getStore());`],
      [2, () => `store.enterWith(${label()});`],
      [2, () => `note(${label()}, frames());`],
      [1, () => `note(${label()}, capturedFrames());`],
      [1, () => `void Promise.reject(new Error(${label()})).catch(error => note(${label()}, error.message));`],
      [1, () => `void Promise.reject(new Error(${label()}));`],
      [1, () => `{ const rejected = Promise.reject(new Error(${label()})); setImmediate(() => rejected.catch(() => note(${label()}))); }`], // prettier-ignore
      [1, () => `emitter.emit("aside", ${label()});`],
      [1, () => `queueMicrotask(() => process.nextTick(() => note(${label()})));`],
      [1, () => `process.nextTick(() => queueMicrotask(() => note(${label()})));`],
      [1, drain],
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
      [1, () => `await new Promise(resolve => process.nextTick(resolve));`],
      [1, () => `await new Promise(resolve => queueMicrotask(() => resolve(0)));`],
      [1, () => `note(${label()}, (await steps.next()).value);`],
      [1, () => `for await (const step of few(${label()})) note(${label()}, step);`],
      [1, () => `for await (const step of few(${label()})) { note(${label()}, step); break; }`],
      [1, () => `for await (const step of [settled, ${random.between(1, 9)}]) note(${label()}, step);`],
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

  const depth = random.pick([1, 1, 2, 2, 3, 4, 5, 6, 7]);
  const functions: string[] = [];
  type Kind = "declaration" | "arrow" | "method" | "generator" | "plain";
  type Parameters = "one" | "rest" | "default" | "many";
  const kinds: Kind[] = [];
  const parameters: Parameters[] = [];
  for (let level = 0; level < depth; level++) {
    kinds.push(
      random.weighted<Kind>([
        [8, "declaration"],
        [2, "arrow"],
        [2, "method"],
        [1, "generator"],
        [level > 0 && level < depth - 1 ? 2 : 0, "plain"],
      ]),
    );
    parameters.push(
      kinds[level] === "generator"
        ? "one"
        : random.weighted<Parameters>([
            [8, "one"],
            [2, "rest"],
            [1, "default"],
            [2, "many"],
          ]),
    );
  }
  const name = (level: number) => (kinds[level] === "method" ? `holder${level}.level${level}` : `level${level}`);
  const letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const parameterList = (level: number) =>
    ({
      one: `n${as("number")}`,
      rest: `n${as("number")}, ...rest${as("number[]")}`,
      default: `n${as("number")}, extra${as("number")} = (note(${label()}), 0)`,
      many: `n${as("number")}, ${letters.map(letter => `${letter}${typed ? "?: number" : ""}`).join(", ")}`,
    })[parameters[level]];
  // The arguments behind the first: fewer than the parameters, as many, or more.
  const moreArguments = (level: number) => {
    const most = { one: 0, rest: 12, default: 1, many: letters.length }[parameters[level]];
    const count = random.pick([0, 0, 1, most]);
    return Array.from({ length: Math.min(count, most) }, (_, index) => `, ${index}`).join("");
  };
  // How level n reaches level n + 1. `call` is the expression whose value is awaited.
  const link = (level: number): { before: string; call: string } => {
    const callee = name(level + 1);
    const direct = `${callee}(n + 1${moreArguments(level + 1)})`;
    return random.weighted([
      [6, () => ({ before: "", call: direct })],
      [3, () => ({ before: "", call: `table[${level + 1}](n + 1)` })],
      [3, () => ({ before: `const next = () => ${direct};`, call: `next()` })],
      [1, () => ({ before: `const next = async () => ${direct};`, call: `next()` })],
      [1, () => ({ before: `const next = async () => await ${direct};`, call: `next()` })],
      [3, () => ({ before: `const next = ${callee}.bind(null, n + 1);`, call: `next()` })],
      [1, () => ({ before: "", call: `${callee}.call(null, n + 1${moreArguments(level + 1)})` })],
      [1, () => ({ before: "", call: `${callee}.apply(null, [n + 1])` })],
      [1, () => ({ before: "", call: `Reflect.apply(${callee}, null, [n + 1])` })],
      [3, () => ({ before: "", call: `passOn(${callee}, n + 1)` })],
      [3, () => ({ before: "", call: `resolved(${callee}, n + 1)` })],
      [2, () => ({ before: "", call: `handled(${callee}, n + 1, ${label()})` })],
      [2, () => ({ before: "", call: `Promise.resolve(${direct})` })],
      [1, () => ({ before: "", call: `new Promise(resolve => resolve(${direct}))` })],
      [2, () => ({ before: "", call: `${direct}.then(${typed ? "(value: any)" : "value"} => (note(${label()}, value), value))` })], // prettier-ignore
      [1, () => ({ before: "", call: `${direct}.finally(() => note(${label()}))` })],
      [1, () => ({ before: "", call: `Promise.all([${direct}, settled]).then(values => values[0])` })],
      [1, () => ({ before: "", call: `Promise.race([${direct}, later()])` })],
      [1, () => ({ before: "", call: `(n % 2 ? ${direct} : settled)` })],
      [1, () => ({ before: "", call: `({ then(resolve${any}, reject${any}) { note(${label()}); ${direct}.then(resolve, reject); } }${typed ? " as any" : ""})` })], // prettier-ignore
      [2, () => ({ before: `const kept = ${direct}; ${aside()}`, call: `kept` })],
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
        random.weighted([
          [6, () => `${awaits} const result${any} = value;`],
          [
            3,
            () =>
              `let result${any} = -1; try { ${awaits} result = value; } catch (error${any}) { note(${label()}, error.message); }`,
          ],
          [1, () => `let result${any} = -1; try { ${awaits} result = value; } finally { note(${label()}); }`],
        ])(),
      );
      lines.push(asides(2));
      if (random.chance(0.15)) lines.push(otherAwait(), asides(1));
      lines.push(
        random.weighted([
          [17, () => `return result;`],
          [2, () => `return ${name(level + 1)}(n + 100);`],
          [1, () => `return await ${name(level + 1)}(n + 100);`],
        ])(),
      );
    }
    const body = lines.filter(Boolean).join(" ");
    const list = parameterList(level);
    const promise = as("Promise<any>");
    functions.push(
      {
        declaration: () => `async function level${level}(${list})${promise} { ${body} }`,
        arrow: () => `const level${level} = async (${list})${promise} => { ${body} };`,
        method: () => `const holder${level} = { async level${level}(${list})${promise} { ${body} } };`,
        // The value that the generator returns is the value of its first step.
        generator: () =>
          `async function* level${level}steps(${list})${as("AsyncGenerator<any, any, any>")} { ${body} }\n` +
          `function level${level}(n${as("number")})${any} { return level${level}steps(n).next().then(step => step.value); }`,
        // No async function: it hands on what it called.
        plain: () =>
          `function level${level}(${list})${any} { note(${label()}, n); ${asides(1)} return ${name(level + 1)}(n + 1); }`,
      }[kinds[level]](),
    );
  }

  // What the callback of the host does with the chain.
  const first = name(0);
  const use = (): string =>
    random.weighted([
      [5, () => `return ${first}(0);`],
      [3, () => `return ${first}(0).then(${typed ? "(value: any)" : "value"} => note(${label()}, value), ${typed ? "(error: any)" : "error"} => note(${label()}, error.message));`], // prettier-ignore
      [
        2,
        () =>
          `${first}(0).then(${typed ? "(value: any)" : "value"} => note(${label()}, value)).catch(${typed ? "(error: any)" : "error"} => note(${label()}, error.message)); ${asides(2)}`,
      ],
      [2, () => `const chain = ${first}(0); ${asides(2)} return chain.catch(${typed ? "(error: any)" : "error"} => note(${label()}, error.message));`], // prettier-ignore
      [1, () => `${asides(2)} return passOn(${first}, 0);`],
      [1, () => `void ${first}(0).catch(() => {}); return ${first}(50).catch(() => {});`],
      [1, () => `const chain = ${first}(0).catch(() => {}); ${drain()} return chain;`],
    ])();

  // The body of the module calls the chain itself.
  const inTheBody = () =>
    `try { note(${label()}, await ${random.pick([`${first}(0)`, `${first}(0)`, `${first}(0)`, `passOn(${first}, 0)`, `table[0](0)`, `enter()`])}); } catch (error${any}) { note(${label()}, error.message); } ${asides(2)}`;
  const answers = random.pick([
    `async fetch() { try { await enter(); } catch {} ${asides(1)} return new Response("ok"); }`,
    `fetch() { return Promise.resolve(enter()).then(() => new Response("ok"), () => new Response("no")); }`,
    `async fetch() { const chain = enter(); ${asides(2)} try { await chain; } catch {} return new Response("ok"); }`,
  ]);
  const entries: { weight?: number; entry: string; before?: string; after?: string }[] = [
    { entry: `setImmediate(enter)` },
    { entry: `setTimeout(enter, 0)` },
    { entry: `process.nextTick(enter)` },
    { entry: `queueMicrotask(enter)` },
    { entry: `settled.then(enter)` },
    { entry: `emitter.once("enter", enter); setImmediate(() => emitter.emit("enter"))` },
    { entry: `target.addEventListener("enter", enter, { once: true }); setImmediate(() => target.dispatchEvent(new Event("enter")))` }, // prettier-ignore
    { entry: `setImmediate(() => { enter(); note(${label()}); })` },
    { entry: `setImmediate(() => store.run(${label()}, enter))` },
    { entry: `channel.port1.postMessage(0)` },
    { entry: `stat(".", () => enter())` },
    { entry: `Readable.from([1]).on("data", () => enter())` },
    { entry: `{ const timer = setInterval(() => { clearInterval(timer); return enter(); }, 0); }` },
    { entry: `process.once("unhandledRejection", () => enter()); void Promise.reject(new Error(${label()}))` },
    // The jobs run inside a callback, which goes on behind them.
    { weight: 2, entry: `setImmediate(() => { settled.then(enter); ${drain()} })` },
    { weight: 2, entry: `setImmediate(() => { enter(); ${drain()} })` },
    { weight: 2, entry: inTheBody() },
    { weight: 2, entry: `await settled; ${inTheBody()}` },
    // The body of the module is resumed by jobs that run inside a callback.
    { weight: 3, entry: `setImmediate(() => { openGate(0); ${drain()} }); await gate; ${inTheBody()}` },
    { weight: 3, entry: `queueMicrotask(() => { openGate(0); ${drain()} }); await gate; ${inTheBody()}` },
    { weight: 3, entry: `process.nextTick(() => { openGate(0); ${drain()} }); await gate; ${inTheBody()}` },
    {
      weight: 3,
      before: `const server = Bun.serve({ port: 0, ${answers} });`,
      entry: `await fetch(server.url).then(response => response.text())`,
      after: `await server.stop(true);`,
    },
    {
      weight: 3,
      before:
        `const server = createServer((request, response) => { const end = () => response.end("ok"); Promise.resolve(enter()).then(end, end); ${asides(1)} });\n` +
        `await new Promise${typed ? "<void>" : ""}(resolve => server.listen(0, resolve));`,
      entry: `await fetch("http://localhost:" + (server.address()${typed ? " as any" : ""}).port).then(response => response.text())`,
      after: `server.close();`,
    },
  ];
  if (withModules) {
    entries.push(
      { entry: `setImmediate(() => { ${requires()} note(${label()}); })` },
      {
        weight: 3,
        entry: `queueMicrotask(() => { ${requires()} openGate(0); note(${label()}); }); await gate; ${inTheBody()}`,
      },
      { entry: `setImmediate(() => import("${moduleThatAwaits()}").then(enter))` },
      { entry: `await import("${moduleThatAwaits()}"); ${inTheBody()}` },
    );
  }
  const { entry, before = "", after = "" } = random.weighted(entries.map(each => [each.weight ?? 1, each] as const));
  const rounds = random.pick([1, 2, 3, 40]);
  const body = use();

  const text = `import { drainMicrotasks } from "bun:jsc";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { stat } from "node:fs";
import { createServer } from "node:http";
import { Readable } from "node:stream";
const log${as("string[]")} = [];
function note(step${as("string")}, value${typed ? "?: any" : ""}) {
  log.push(value === undefined ? step : step + "=" + String(value));
}
const store = new AsyncLocalStorage${typed ? "<string>" : ""}();
const emitter = new EventEmitter();
emitter.on("aside", step => note(step));
const target = new EventTarget();
const settled = Promise.resolve(0);
let openGate${as("(value: number) => void")} = () => {};
let gate${as("Promise<number>")} = settled;
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
async function* few(step${as("string")}) {
  try {
    yield 1;
    process.nextTick(() => note(step + "k"));
    queueMicrotask(() => note(step + "m"));
    yield 2;
  } finally {
    note(step + "f");
  }
}
async function* forever() {
  for (let i = 0; ; i++) yield i;
}
const steps = forever();
// The names of the functions of this file on the stack, and which of them are there as async callers.
function namesIn(stack${as("string")}) {
  return stack
    .split("\\n")
    .map(line => /at (async )?(?:holder\\d+\\.)?(level\\d+\\w*|enter|passOn|resolved|handled|noted)\\b/.exec(line))
    .filter(match => match !== null)
    .map(match => (match${typed ? "!" : ""}[1] ? "~" : "") + match${typed ? "!" : ""}[2])
    .join(",");
}
function frames() {
  return namesIn(new Error().stack ?? "");
}
function capturedFrames() {
  const holder = { stack: "" };
  Error.captureStackTrace(holder);
  return namesIn(holder.stack);
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
function handled(callee${as("(n: number) => any")}, n${as("number")}, step${as("string")}) {
  return callee(n)
    .then((value${any}) => (note(step + "v", value), value))
    .catch((error${any}) => (note(step + "e", error.message), -2));
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
  ${body}
}
Object.assign(globalThis, { note, chain: ${first}, openGate: (value${as("number")}) => openGate(value) });
channel.port2.onmessage = () => enter();
process.on("unhandledRejection", error => note("unhandled", (error${typed ? " as Error" : ""}).message));
process.on("rejectionHandled", () => note("handled late"));
${before}
for (; round < ${rounds}; round++) {
  log.length = 0;
  gate = new Promise(resolve => {
    openGate = resolve;
  });
  ${entry};
  // Until the round has begun, and then long enough for everything that it has queued.
  while (log.length === 0) await new Promise(resolve => setImmediate(resolve));
  for (let turn = 0; turn < 30; turn++) await new Promise(resolve => setImmediate(resolve));
  const order = log.join(" ");
  orders.set(order, (orders.get(order) ?? 0) + 1);
}
channel.port1.close();
${after}
for (const [order, times] of orders) console.log(times, order);
`;
  return { text, files };
}
