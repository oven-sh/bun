// A callee may return before it needs an argument that is made for the call: a rest array, an object literal, its arguments object.
// The caller then makes it only on the way that goes on. What the program prints stays the same, and so does every stack.
import { buildBothWays } from "./build-both-ways";

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

const verbs = {
  read(path) {
    return "read " + path;
  },
};
["get", "put", "post"].forEach(function (method) {
  verbs[method] = function (path) {
    if (method === "get" && arguments.length === 1) return this.read(path);
    lines.push(method + " " + path + " " + Array.prototype.slice.call(arguments, 1).join("|"));
    return this;
  };
});

module.exports = { createLogger, lines, readsSoFar: () => reads, whoIsThis, thisBehindTest, countsArguments, verbs };
`;

const main = `import { countsArguments, createLogger as create, lines, readsSoFar, thisBehindTest, verbs, whoIsThis } from "./logger.cjs";

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
type Verbs = Record<string, (...args: unknown[]) => unknown>;
const names = ["get", "get", "get", "put"];
let ones = 0;
for (let i = 0; i < 40000; i++) if ((verbs as Verbs)[names[i % 4 === 3 && i > 39990 ? 3 : 0]!]!("x") === "read x") ones++;
console.log(ones, (verbs as Verbs).get!("x", 1, 2) === verbs, (verbs as Verbs).post!("y") === verbs, lines.slice(-3).join(";"));

// Handed around as a value, applied, bound and spread.
const table = [log, other, viaCall as (...args: unknown[]) => unknown];
other.enabled = true;
const many = Array.from({ length: 40 }, (_, i) => i);
console.log(table.map(f => JSON.stringify(f.apply(null, ["%d", 5, 6]))).join(" "), JSON.stringify(other.bind(null, "%s")("bound", 1)), (other(...many) as unknown[]).length);
`;

// What the caller knows of an argument may decide the test in front of the early return, for it or against it.
// What the caller asks of the result is answered on each way out of the callee by what that way hands back, and a callee may hand back what its written type rules out.
const results = `let parses = 0;
function unit(v: number | string): number {
  if (typeof v === "number") return v;
  parses++;
  let n = 0;
  for (const c of v) n = n * 10 + (c.charCodeAt(0) - 48);
  return n;
}
let numbers = 0;
for (let i = 0; i < 1000; i++) numbers += unit(3.5);
console.log(numbers, parses);
let texts = 0;
for (let i = 0; i < 1000; i++) texts += unit("12");
console.log(texts, parses);
let mixed = 0;
for (const v of [1, "2", 3.5, "40"]) mixed += unit(v);
console.log(mixed, parses);

// One test throws, and the other is decided against the return.
function pick(k: string | undefined, d: number | string): number | string {
  if (k === undefined) throw new TypeError("no key");
  if (typeof d === "number") return d;
  parses++;
  return k + d;
}
console.log(pick("a", 1), pick("a", "b"), parses);
try {
  pick(undefined, "x");
} catch (error) {
  console.log((error as Error).message, parses);
}

type Holder = { kind: string; n?: number };
const seen: string[] = [];
function lookup(o: Holder): number | string | undefined {
  if (o.kind === "n") return o.n;
  if (o.kind === "none") return undefined;
  seen.push(o.kind);
  return o.kind.length > 3 ? o.kind : o.kind.length;
}
function classify(o: Holder): string {
  const v = lookup(o);
  if (typeof v === "number") return "number " + v;
  return "other " + String(v);
}
console.log(classify({ kind: "n", n: 4 }), classify({ kind: "n" }), classify({ kind: "none" }), classify({ kind: "abc" }), classify({ kind: "abcd" }), seen.join());

// The result, and what was made in front of the call, are read behind both arms.
function explain(o: Holder): string {
  const before = o.kind.length;
  const v = lookup(o);
  let text: string;
  if (typeof v === "number") text = "n" + (v + before);
  else text = "o" + before;
  return text + ":" + String(v);
}
console.log(explain({ kind: "n", n: 4 }), explain({ kind: "none" }), explain({ kind: "abc" }), explain({ kind: "abcd" }), seen.length);

type User = { id: number; cached?: string };
const made: number[] = [];
function nameOf(u: User): string {
  if (u.cached) return u.cached;
  made.push(u.id);
  if (u.id < 0) return u.id as unknown as string;
  u.cached = "user" + u.id;
  return u.cached;
}
function lengthOfName(u: User): number {
  const s = nameOf(u);
  return s.length;
}
function viaTailCall(u: User): string {
  return nameOf(u);
}
const user: User = { id: 7 };
console.log(lengthOfName(user), lengthOfName(user), lengthOfName({ id: -1 }), lengthOfName({ id: 12, cached: "x" }), made.join());
console.log(viaTailCall({ id: -2 }).length, viaTailCall({ id: 3 }).length, made.join());
`;

buildBothWays("arguments of a call that returns early", {
  "each way out of the callee answers what the caller asks of the result": {
    files: { "main.ts": results },
    prints:
      "3500 0\n" +
      "12000 1000\n" +
      "46.5 1002\n" +
      "1 ab 1003\n" +
      "no key 1003\n" +
      "number 4 other undefined other undefined number 3 other abcd abc,abcd\n" +
      "n5:4 o4:undefined n6:3 o4:abcd 4\n" +
      "5 5 undefined 1 7,-1\n" +
      "undefined 5 7,-1,-2,3\n",
  },
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
      "39997 true true put x ;get x 1|2;post y \n" +
      ' ["other","5",6] "NaN56" 41\n',
  },
});
