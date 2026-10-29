// Two AsyncLocalStorage objects, each made at a time of its own: at the top of the module, inside a promise job, a tick, a timer or a request.
// A tree of steps enters, runs, leaves, binds and snapshots stores inside every kind of job: promise reactions, awaits, thenables, microtasks,
// ticks, timers, immediates, async generators, event listeners, callbacks of the file system and requests to a server. Every step writes down
// what both stores hold, so a store that outlives the job that set it, or is lost on the way into a job, shows.
import type { Random } from "./random";

type Step = (random: Random, depth: number, label: () => string) => string;

const stores = ["first", "second"] as const;

function see(label: string): string {
  return `see("${label}");`;
}

function body(random: Random, depth: number, label: () => string, isAsync: boolean): string {
  const count = depth <= 0 ? 1 : random.between(1, 3);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const step =
      depth <= 0
        ? leaf
        : random.weighted<Step>(
            isAsync
              ? [
                  [3, leaf],
                  [4, nested],
                  [5, awaited],
                ]
              : [
                  [3, leaf],
                  [6, nested],
                ],
          );
    lines.push(step(random, depth - 1, label));
  }
  lines.push(see(label()));
  return lines.join("\n");
}

const leaf: Step = (random, _depth, label) => {
  const store = random.pick(stores);
  return random.weighted([
    [5, `${store}?.enterWith("${label()}");`],
    [3, see(label())],
    [2, `${store} ??= new AsyncLocalStorage();`],
    [1, `${store}?.enterWith(undefined);`],
    [1, `${store}?.disable();`],
    [1, `kept.push(AsyncLocalStorage.snapshot());`],
    [1, `kept.push(AsyncLocalStorage.bind(run => run()));`],
    [1, `kept.push(new AsyncResource("kept").runInAsyncScope.bind(new AsyncResource("kept")));`],
  ]);
};

// Steps that may stand anywhere. What they start and do not wait for has run by the time the program prints.
const nested: Step = (random, depth, label) => {
  const store = random.pick(stores);
  const inner = (isAsync = false) => body(random, depth, label, isAsync);
  return random.weighted<() => string>([
    [4, () => `(${store} ??= new AsyncLocalStorage()).run("${label()}", () => {\n${inner()}\n});`],
    [2, () => `(${store} ??= new AsyncLocalStorage()).exit(() => {\n${inner()}\n});`],
    [4, () => `queueMicrotask(() => {\n${inner()}\n});`],
    [4, () => `Promise.resolve().then(() => {\n${inner()}\n});`],
    [2, () => `Promise.reject(1).catch(() => {\n${inner()}\n});`],
    [2, () => `Promise.resolve().finally(() => {\n${inner()}\n});`],
    [3, () => `process.nextTick(() => {\n${inner()}\n});`],
    [2, () => `(async () => {\n${inner()}\nawait null;\n${inner()}\n})();`],
    [2, () => `Promise.resolve({ then(resolve) {\n${inner()}\nresolve();\n} });`],
    [2, () => `kept.shift()?.(() => {\n${inner()}\n});`],
    [1, () => `AsyncLocalStorage.bind(() => {\n${inner()}\n})();`],
    [1, () => `AsyncLocalStorage.snapshot()(() => {\n${inner()}\n});`],
    [1, () => `new AsyncResource("made").runInAsyncScope(() => {\n${inner()}\n});`],
    [1, () => `emitter.once("${label()}", () => {\n${inner()}\n});\nemitter.emit(emitter.eventNames()[0]);`],
    [1, () => `[1].forEach(() => {\n${inner()}\n});`],
    [
      1,
      () =>
        `try {\n(${store} ??= new AsyncLocalStorage()).run("${label()}", () => {\n${inner()}\nthrow new Error("out");\n});\n} catch {\n${see(label())}\n}`,
    ],
  ])();
};

// Steps of an async function: each is waited for, so the order of what is written down does not hang on the clock.
const awaited: Step = (random, depth, label) => {
  const store = random.pick(stores);
  const inner = (isAsync = false) => body(random, depth, label, isAsync);
  return random.weighted<() => string>([
    [4, () => `await null;`],
    [2, () => `await Promise.resolve();`],
    [2, () => `await { then(resolve) {\n${inner()}\nresolve();\n} };`],
    [3, () => `await (async () => {\n${inner(true)}\n})();`],
    [3, () => `await (${store} ??= new AsyncLocalStorage()).run("${label()}", async () => {\n${inner(true)}\n});`],
    [3, () => `await new Promise(resolve => setTimeout(() => {\n${inner()}\nresolve();\n}, 0));`],
    [3, () => `await new Promise(resolve => setImmediate(() => {\n${inner()}\nresolve();\n}));`],
    [2, () => `await new Promise(resolve => process.nextTick(() => {\n${inner()}\nresolve();\n}));`],
    [2, () => `await new Promise(resolve => queueMicrotask(() => {\n${inner()}\nresolve();\n}));`],
    [2, () => `await new Promise(resolve => stat("/", () => {\n${inner()}\nresolve();\n}));`],
    [1, () => `await Bun.sleep(0);`],
    [1, () => `await import("node:path");`],
    [
      2,
      () =>
        `for await (const each of (async function* () {\n${inner(true)}\nyield 1;\n${inner(true)}\n})()) {\n${see(label())}\n}`,
    ],
    [
      1,
      () =>
        `await Promise.all([\n(async () => {\n${inner()}\nawait null;\n${inner()}\n})(),\n(async () => {\n${inner()}\nawait null;\n${inner()}\n})(),\n]);`,
    ],
    [2, () => `await ask(async () => {\n${inner(true)}\n});`],
    [1, () => `await askNode(() => {\n${inner()}\n});`],
  ])();
};

export function generate(random: Random): string {
  let count = 0;
  const label = () => `s${++count}`;
  const madeAtTheTop = random.pick([[], [], ["first"], ["first", "second"]]);
  return `import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { stat } from "node:fs";
import { createServer } from "node:http";
const lines = [];
const kept = [];
const emitter = new EventEmitter();
let first = ${madeAtTheTop.includes("first") ? "new AsyncLocalStorage()" : "undefined"};
let second = ${madeAtTheTop.includes("second") ? "new AsyncLocalStorage()" : "undefined"};
const see = label => lines.push(label + " " + first?.getStore() + " " + second?.getStore());
async function ask(handle) {
const server = Bun.serve({
port: 0,
async fetch() {
await handle();
return new Response("answer");
},
});
await (await fetch(server.url)).text();
see("behind a request");
await (await fetch(server.url)).text();
await server.stop(true);
}
async function askNode(handle) {
const server = createServer((request, response) => {
handle();
response.end("answer");
});
await new Promise(resolve => server.listen(0, resolve));
await (await fetch("http://127.0.0.1:" + server.address().port)).text();
see("behind a request");
await new Promise(resolve => {
server.close(resolve);
server.closeAllConnections();
});
}
${body(random, random.between(1, 2), label, false)}
${random.chance(0.8) ? `await (async () => {\n${body(random, random.between(2, 4), label, true)}\n})();` : body(random, 3, label, true)}
${see("behind everything")}
await new Promise(resolve => setTimeout(resolve, 5));
${see("at the end")}
console.log(lines.join("\\n"));
`;
}
