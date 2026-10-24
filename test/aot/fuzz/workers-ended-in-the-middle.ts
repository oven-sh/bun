// A Worker is busy without end in compiled code, and is ended from outside or ends itself from deep inside: it must end soon, no finally of it may run, and the main thread and the Workers beside it go on as before.
//
//   busy with  empty loops, loops that count, loops over arrays, typed arrays and texts, nested loops, loops that call, allocate, throw and catch, loops in callbacks of built-ins, in getters, constructors, generators, async functions,
//              recursion that never ends its work, microtasks without end, built-ins called without end, a wait on shared memory
//   around it  nothing, a try with a finally, a using, a catch that goes on, many frames each with a finally
//   ended by   worker.terminate() from the main thread, process.exit() in the Worker from deep inside
//
// The program is its own Worker, so it stands alone in its build: sources.ts marks it and the driver gives it a build to itself.
import type { Random } from "./random";

// The body of a function that never returns. `spin` counts so that nothing can be folded away; `list`, `bytes` and `words` are there to be walked.
const busy: readonly (readonly [name: string, body: string])[] = [
  ["an-empty-loop", `for (;;) {}`],
  ["while-true", `while (true) spin++;`],
  ["do-while", `do spin++; while (spin !== -1);`],
  ["a-loop-that-counts", `for (let i = 0; i >= 0; i = (i + 1) | 0) if (i === 2147483647) i = 0;`],
  ["a-loop-of-doubles", `for (let x = 0.5; x > 0; x += 1) if (x > 1e9) x = 0.5;`],
  ["a-loop-over-an-array", `for (;;) for (let i = 0; i < list.length; i++) spin += list[i];`],
  ["a-loop-over-a-typed-array", `for (;;) for (let i = 0; i < bytes.length; i++) spin += bytes[i];`],
  ["a-loop-over-a-text", `for (;;) for (let i = 0; i < words.length; i++) spin += words.charCodeAt(i);`],
  ["for-of", `for (;;) for (const each of list) spin += each;`],
  ["for-in", `for (;;) for (const key in record) spin += key.length;`],
  ["nested-loops", `for (;;) for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++) spin += i ^ j;`],
  ["a-loop-with-a-label", `outer: for (;;) for (let i = 0; ; i++) if (i > 1000) continue outer;`],
  ["a-loop-that-calls", `for (;;) spin = step(spin);`],
  ["a-loop-that-calls-a-value", `for (;;) spin = steps[spin & 1](spin);`],
  ["a-loop-that-allocates", `for (;;) spin += [spin, { spin }].length;`],
  ["a-loop-that-joins-texts", `for (let text = ""; ; text = text.length > 100 ? "" : text + "x") spin += text.length;`],
  ["a-loop-that-throws-and-catches", `for (;;)\n    try {\n      throw new Error("again");\n    } catch {\n      spin++;\n    }`],
  ["a-switch-in-a-loop", `for (;;)\n    switch (spin & 3) {\n      case 0:\n        spin += 3;\n        break;\n      case 1:\n        spin += 2;\n        continue;\n      default:\n        spin++;\n    }`],
  ["a-callback-of-for-each", `[1].forEach(() => {\n    for (;;) spin++;\n  });`],
  ["for-each-without-end", `for (;;) list.forEach(each => void (spin += each));`],
  ["a-comparer", `[2, 1].sort(() => {\n    for (;;) spin++;\n  });`],
  ["a-replacer", `"a".replace(/a/, () => {\n    for (;;) spin++;\n  });`],
  ["a-getter", `void {\n    get endless(): number {\n      for (;;) spin++;\n    },\n  }.endless;`],
  ["a-constructor", `new (class {\n    constructor() {\n      for (;;) spin++;\n    }\n  })();`],
  ["a-generator", `for (const each of (function* () {\n    for (;;) yield 1;\n  })())\n    spin += each;`],
  ["a-loop-inside-a-generator", `(function* () {\n    for (;;) spin++;\n  })().next();`],
  ["recursion-again-and-again", `for (;;) spin += descend(200);`],
  ["built-ins-without-end", `for (;;) spin += JSON.stringify(JSON.parse('{"a":[1,2,3]}')).length + Math.max(...list) + words.indexOf("z");`],
  ["maps-without-end", `for (const map = new Map<number, number>(); ; map.size > 100 && map.clear()) map.set(spin++, spin);`],
  ["regular-expressions-without-end", `for (;;) spin += /(a+)+b/.test("aaaaaaaaaaaac") ? 1 : 2;`],
  ["a-wait-on-shared-memory", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`],
];

// Never settle, and never give the event loop a turn.
const busyAsync: readonly (readonly [name: string, body: string])[] = [
  ["awaits-without-end", `for (;;) await null;`],
  ["awaits-of-async-functions-without-end", `for (;;) spin += await soon(spin & 1);`],
  ["for-await-without-end", `for await (const each of (async function* () {\n    for (;;) yield 1;\n  })())\n    spin += each;`],
  ["a-loop-behind-an-await", `await null;\n  for (;;) spin++;`],
  ["handlers-without-end", `const again = (): Promise<void> => Promise.resolve().then(again);\n  await again();`],
  ["microtasks-without-end", `const again = () => queueMicrotask(again);\n  again();\n  await new Promise(() => {});`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const cases = random.between(2, 5);
  const names: string[] = [];
  const bodies: string[] = [];
  const ends: string[] = [];
  for (let id = 0; id < cases; id++) {
    const isAsync = random.chance(0.2);
    const [name, body] = isAsync ? pick(busyAsync) : pick(busy);
    const endsItself = random.chance(0.25);
    const [maybeAsync, maybeAwait, result] = isAsync ? ["async ", "await ", "Promise<void>"] : ["", "", "void"];
    const inside = endsItself ? `process.exit(${id + 2});` : body;
    const [aroundName, around] = pick<readonly [string, (call: string) => string]>([
      ["bare", call => call],
      ["bare", call => call],
      ["in-a-try-with-a-finally", call => `try {\n    ${call}\n  } finally {\n    told("a finally ran");\n  }`],
      ["in-a-try-with-a-catch", call => `for (;;)\n    try {\n      ${call}\n    } catch {\n      told("a catch ran");\n    }`],
      ["beside-a-using", call => `using _resource = {\n    [Symbol.dispose]() {\n      told("a disposer ran");\n    },\n  };\n  ${call}`],
      ["many-frames-down", call => `${maybeAwait}${isAsync ? "downAsync" : "down"}(30, ${maybeAsync}() => {\n    ${call}\n  });`],
    ]);
    names.push(`${endsItself ? "process-exit" : name}--${aroundName}${endsItself ? "" : "--terminated"}`);
    bodies.push(`${maybeAsync}function busy${id}(): ${result} {\n  ${inside}\n}\n${maybeAsync}function case${id}(): ${result} {\n  ${around(`${maybeAwait}busy${id}();`)}\n}`);
    ends.push(endsItself ? "false" : "true");
  }
  const together = random.chance(0.3);
  return `// ${names.join(" ")}${together ? " all-at-once" : ""}
declare function require(name: string): any;
declare const process: any;
const { isMainThread, parentPort, Worker, workerData } = require("node:worker_threads");
let spin = 0;
const list = [1, 2, 3, 4, 5, 6, 7, 8];
const bytes = new Uint8Array(64).fill(1);
const words = "where the worker ends";
const record: Record<string, number> = { a: 1, b: 2, c: 3 };
function step(n: number): number {
  return (n + 1) | 0;
}
const steps = [step, (n: number) => (n + 3) | 0];
function descend(depth: number): number {
  return depth > 0 ? descend(depth - 1) + 1 : 0;
}
async function soon(n: number): Promise<number> {
  await null;
  return n + 1;
}
function told(what: string): void {
  parentPort.postMessage(what);
}
function down(depth: number, run: () => void): void {
  try {
    if (depth > 0) down(depth - 1, run);
    else run();
  } finally {
    told("a finally ran");
  }
}
async function downAsync(depth: number, run: () => Promise<void>): Promise<void> {
  try {
    if (depth > 0) await downAsync(depth - 1, run);
    else await run();
  } finally {
    told("a finally ran");
  }
}
${bodies.join("\n")}
const cases = [${Array.from({ length: cases }, (_, id) => `case${id}`).join(", ")}];
const isTerminated = [${ends.join(", ")}];
function answer(): string {
  return JSON.stringify(list.map(each => ({ each, twice: step(each) + descend(each) })));
}
const atFirst = answer();
function works(): string {
  return answer() === atFirst ? "works" : "DOES NOT WORK";
}
function ended(id: number): Promise<string> {
  return new Promise(resolve => {
    const heard: string[] = [];
    const worker = new Worker(new URL(import.meta.url), { workerData: id });
    worker.on("message", (message: string) => {
      if (message !== "ready") return void heard.push(message);
      if (isTerminated[id]) setTimeout(() => void worker.terminate(), 5);
    });
    worker.on("error", (error: Error) => heard.push("error " + error.name));
    worker.on("exit", (code: number) => resolve(id + ": exit " + code + " " + heard.join() + " " + works()));
  });
}
if (isMainThread) {
  ${together ? `for (const line of await Promise.all(cases.map((_, id) => ended(id)))) console.log(line);` : `for (let id = 0; id < cases.length; id++) console.log(await ended(id));`}
  console.log("the end", works());
} else {
  told("ready");
  // The message leaves in a turn of the event loop.
  setTimeout(() => void cases[workerData](), 1);
}
`;
}
