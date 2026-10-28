// Functions made from text, each called often: async functions, switches, `this`, and global variables that change while the functions are in use.
import { runInThisContext } from "node:vm";

globalThis.limit = 3;
runInThisContext("let step = 2; const label = 'L';");

const readGlobals = new Function("n", "return limit + step + n + label.length;");
const writeGlobal = new Function("n", "step = n; return step;");
const readMissing = new Function("return typeof missing === 'undefined' ? 'none' : missing;");
const readLate = new Function("return late;");

const waitTwice = new Function(
  "double",
  `return async function waitTwice(value) {
    const first = await double(value);
    const second = await double(first);
    return first + second + limit;
  }`,
)(async value => value * 2);

const failLate = new Function(
  `return async function failLate(value) {
    await null;
    if (value % 100 === 99) throw new RangeError("value " + value);
    return value;
  }`,
)();

const classify = new Function(
  "kind",
  "n",
  `switch (kind) {
    case "small": n += 1; break;
    case "large": n += 100; break;
    default: n -= 1;
  }
  switch (n & 7) {
    case 0: return "zero";
    case 1: return "one";
    case 3: return "three";
    case 6: return "six";
  }
  return "other";`,
);
const classifyNumber = new Function("n", "switch (n) { case 1: return 'a'; case 2: return 'b'; case 4: return 'd'; default: return 'z'; }");

const strictThis = new Function("'use strict'; return this;");
const sloppyThis = new Function("return this;");
class Point {
  x = 1;
}

function describe(value) {
  if (value === globalThis) return "globalThis";
  if (value === null) return "null";
  if (typeof value === "object") return value.constructor.name + ":" + String(value.valueOf === Object.prototype.valueOf ? Object.keys(value) : value.valueOf());
  return typeof value + ":" + String(value);
}

const receivers = [{ a: 1 }, new Point(), [1, 2], 5, 1.5, "text", true, undefined, null, 10n, function named() {}];
const kinds = ["small", "large", "medium", "small" + "", 7];

let sum = 0;
const counts = {};
for (let i = 0; i < 600; i++) {
  sum += readGlobals(i);
  const name = classify(kinds[i % kinds.length], i) + classifyNumber(i % 6) + classifyNumber(i % 3 ? i % 6 + 0.5 : "2");
  counts[name] = (counts[name] ?? 0) + 1;
  if (i === 300) globalThis.limit = 10;
  if (i === 400) runInThisContext("let limit = 50;");
  if (i === 450) delete globalThis.limit;
  if (i === 500) sum += writeGlobal(7);
}
console.log(sum, JSON.stringify(counts));

for (let i = 0; i < 300; i++) {
  for (const receiver of receivers) {
    const strict = describe(strictThis.call(receiver));
    const sloppy = describe(sloppyThis.call(receiver));
    if (i === 0 || i === 299) console.log(i, strict, "|", sloppy);
  }
}
console.log(describe(sloppyThis()), describe(strictThis()));

let missing = "";
for (let i = 0; i < 300; i++) {
  if (i === 200) globalThis.missing = "found";
  if (i === 250) (0, eval)("var missing = 'declared';");
  missing += readMissing()[0];
}
console.log(missing.replace(/(.)\1*/g, (run, letter) => letter + run.length));

let errors = "";
for (let i = 0; i < 300; i++) {
  try {
    if (i === 150) runInThisContext("readLateNow(); let late = 'ready';");
    errors += readLate()[0];
  } catch (error) {
    errors += error.name[0];
  }
  if (i === 100)
    globalThis.readLateNow = () => {
      try {
        readLate();
      } catch (error) {
        errors += "(" + error.message + ")";
      }
    };
}
console.log(errors.replace(/(.)\1*/g, (run, letter) => letter + run.length));

let total = 0;
let failures = 0;
for (let i = 0; i < 400; i++) {
  total += await waitTwice(i);
  try {
    total += await failLate(i);
  } catch (error) {
    failures += error.message.length;
  }
}
console.log(total, failures, (await Promise.all([1, 2, 3].map(waitTwice))).join());
