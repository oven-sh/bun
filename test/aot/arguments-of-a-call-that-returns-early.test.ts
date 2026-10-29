// A callee may return before it touches an argument that the caller makes for the call: a rest array, an object literal.
// The caller then makes it only on the way that goes on. What the program prints stays the same, and so does every stack.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBothWays } from "./build-both-ways";
import { built, slot, spawned } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const logger = `// No "use strict": the functions of this file are sloppy.
const lines = [];
let reads = 0;

function createLogger(namespace) {
  let on = false;
  let previous = 0;
  function log(...args) {
    if (!log.enabled) return;
    const self = log;
    const now = lines.length;
    self.diff = now - previous;
    previous = now;
    args[0] = String(args[0]);
    let index = 0;
    args[0] = args[0].replace(/%([a-z%])/g, (match, format) => {
      if (match === "%%") return "%";
      index++;
      if (format === "s" || format === "d") {
        const value = args[index];
        args.splice(index, 1);
        index--;
        return String(value);
      }
      return match;
    });
    args.unshift(namespace);
    lines.push(args.join(" "));
    return args;
  }
  Object.defineProperty(log, "enabled", {
    enumerable: true,
    configurable: true,
    get() {
      reads++;
      return on;
    },
    set(value) {
      on = value;
    },
  });
  return log;
}

function whoIsThis(...args) {
  if (args.length === 99) return lines;
  return typeof this + " " + args.length;
}

function thisBehindTest(flag, ...args) {
  if (!flag) return typeof this;
  lines.push("this " + typeof this + " " + args.join("+"));
  return args;
}

function countsArguments(first) {
  if (first === "get" && arguments.length === 1) return "one";
  return Array.prototype.slice.call(arguments, 1).join("|");
}

module.exports = { createLogger, lines, readsSoFar: () => reads, whoIsThis, thisBehindTest, countsArguments };
`;

const main = `import { countsArguments, createLogger as create, lines, readsSoFar, thisBehindTest, whoIsThis } from "./logger.cjs";

type Logger = { (...args: unknown[]): unknown[] | undefined; enabled: boolean; diff?: number };
const createLogger = create as (namespace: string) => Logger;

const order: string[] = [];
function note<T>(name: string, value: T): T {
  order.push(name);
  return value;
}

// A logger that is off takes its arguments and returns. They are evaluated all the same, in front of the test.
const log = createLogger("app");
const other = createLogger("other");
let sum = 0;
for (let i = 0; i < 30000; i++) {
  log("request %s %d", "GET", i);
  other("x", i);
  sum += i & 3;
}
console.log(sum, readsSoFar(), lines.length);
console.log(log(note("a", "%s"), note("b", 1), note("c", 2)), order.join(""));

// Switched on, every call gets a list of its own.
log.enabled = true;
const first = log("%s and %d %% %x", "one", 2, 3);
const second = log("%s and %d %% %x", "one", 2, 3);
console.log(JSON.stringify(first), first === second, Array.isArray(first), first!.length, log.diff);
log.enabled = false;
console.log(log("again"), lines.join(";"), log.length, log.name);

// The test may throw, and the stack names the function.
const broken = createLogger("broken");
Object.defineProperty(broken, "enabled", {
  get() {
    throw new Error("no answer");
  },
});
function callsBroken() {
  broken("a", "b");
}
try {
  callsBroken();
} catch (error) {
  const names = String((error as Error).stack)
    .split("\\n")
    .slice(0, 4)
    .map(line => line.trim().split(" ").slice(0, 2).join(" "));
  console.log(names.join(" | "));
}

// An object that is made for the call is the same object wherever the callee puts it.
type Options = { a: number; b: string };
const kept: Options[] = [];
function configure(on: boolean, options: Options): number {
  if (!on) return -1;
  kept.push(options);
  options.a++;
  for (let i = 0; i < 3; i++) kept.push({ a: options.a + i, b: options.b + i });
  return options.a + kept.length;
}
let total = 0;
for (let i = 0; i < 20000; i++) total += configure(i % 5000 === 0, { a: i, b: "k" });
console.log(total, kept.length, JSON.stringify(kept[4]), kept[0] === kept[4], kept[0]!.a);

// The way out may be a call.
function fallback(value: number) {
  return value * 2;
}
function viaCall(value: number, ...rest: number[]): number {
  if (value < 10) return fallback(value);
  let all = value;
  for (const one of rest) all += one;
  rest.length = 0;
  return all;
}
console.log(viaCall(3, 1, 2), viaCall(30, 1, 2), viaCall.length);

// Two ways out, with something done between them.
let steps = 0;
function twoWaysOut(a: boolean, b: boolean, ...rest: string[]) {
  if (a) return "a";
  steps++;
  if (b) return "b" + steps;
  rest.push("!");
  return rest.join("");
}
console.log(twoWaysOut(true, true, "x"), twoWaysOut(false, true, "x"), twoWaysOut(false, false, "x", "y"), steps);

const receiver = { name: "receiver" };
console.log(whoIsThis.call(receiver, 1, 2), whoIsThis.call(receiver, 1), thisBehindTest.call(receiver, false, 1), JSON.stringify(thisBehindTest.call(receiver, true, 1, 2)), lines.at(-1));
const counts = countsArguments as (...args: unknown[]) => string;
console.log(counts("get"), counts("get", 1, 2), counts("put"), counts("put", 7));

// Handed around as a value, applied, bound and spread.
const table = [log, other, viaCall as (...args: unknown[]) => unknown];
other.enabled = true;
const many = Array.from({ length: 40 }, (_, i) => i);
console.log(table.map(f => JSON.stringify(f.apply(null, ["%d", 5, 6]))).join(" "), JSON.stringify(other.bind(null, "%s")("bound", 1)), (other(...many) as unknown[]).length);
`;

buildBothWays("arguments of a call that returns early", {
  "rest arrays and object literals are the same values wherever the callee goes on": {
    files: { "main.ts": main, "logger.cjs": logger },
    prints:
      "45000 60000 0\n" +
      "undefined abc\n" +
      '["app","one and 2 % %x",3] false true 3 1\n' +
      "undefined app one and 2 % %x 3;app one and 2 % %x 3 0 log\n" +
      "Error: no | at get | at log | at callsBroken\n" +
      '10048 16 {"a":5001,"b":"k"} false 1\n' +
      "6 33 1\n" +
      "a b1 xy! 2\n" +
      "object 2 object 1 object [1,2] this object 1+2\n" +
      "one 1|2  7\n" +
      ' ["other","5",6] "NaN56" 41\n',
  },
});

const env = { ...bunEnv, NO_COLOR: "1" };

// A place shows up in the counts with the first free list that it uses up, which is about a thousand cells.
async function cellsMadeByTheProgram(flags: string[]) {
  using dir = tempDir("aot-arguments-of-a-call-that-returns-early", { "main.ts": main, "logger.cjs": logger });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "app.exe" : "app");
  const counts = join(folder, "counts.txt");
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts", "--outfile", executable], folder, env));
  const ran = await spawned([executable], folder, { ...env, [runtimeEnvironment.countsPath]: counts });
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return readFileSync(counts, "utf8")
    .split("\n")
    .filter(line => /^refill \S+ main\.ts:\d+ JSCell:/.test(line));
}

describe.concurrent("a logger that is off and a callee that declines make no argument lists or option objects", () => {
  test.each([
    ["at the usual heat", []],
    ["where all code counts as hot", ["--aot-heat=everything-is-hot"]],
  ])("%s", (_, flags) => slot(async () => expect(await cellsMadeByTheProgram(flags)).toEqual([])), 300_000);
});
