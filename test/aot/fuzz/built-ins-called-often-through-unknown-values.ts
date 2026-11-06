// The cases of ./generators/built-ins-called-through-unknown-values, which its test runs once each, alone and cold. Here one program holds
// one to five of them, each in a function of its own. The call runs 1 to 400 times at one place, and in the middle something changes:
// the value that holds the built-in gets another function, the receiver gets a member or a prototype of its own, an operand is frozen,
// or a collection runs. Each scene prints its first and last lines, a hash of all of them, and what its objects look like at the end.
import { cases, ways, type Case } from "./generators/built-ins-called-through-unknown-values";
import type { Random } from "./random";

type Way = (typeof ways)[string];

// These print, keep the process alive, or hold on to something with every call: a few calls are enough.
const calledSeldom =
  /^(process\.|console\.|MessagePort|setTimeout|setImmediate|queueMicrotask|performance\.|ReadableStream|WritableStream|TransformStream|Blob|Response|Bun\.readableStreamToText|Bun\.file|AbortSignal|AbortController|EventTarget|DisposableStack|crypto\.subtle|structuredClone)/;
const filledByChance = /getRandomValues/;
const method = /^(\w+)\.prototype\.(\w+)$/;

const helpers = `const everything = [];
// A change can leave an iterator without its end: the log fills up and the walk ends with an error.
class Log extends Array {
  push(line) {
    if (this.length >= 20000) throw new RangeError("the log is full");
    return super.push(line);
  }
}
function hashOf(lines) {
  let hash = 0;
  for (const line of lines) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
  return hash;
}
function report(title, log) {
  console.log(title);
  for (const line of log.length > 14 ? [...log.slice(0, 10), "..", ...log.slice(-3)] : log) console.log("  " + line);
  console.log("  " + log.length + " lines, hash " + hashOf(log));
}
// The text of a function and the expression that an error message quotes are not the same in an executable.
function withoutSourceText(value) {
  const text = String(value)
    .replace(/ \\((In|evaluating|near) '[^]*$/, "")
    .replace(/^(Attempted to assign to readonly property|Attempting to define property on object that is not extensible)\\.$/, "the store is refused");
  return /=>|\\bfunction\\b|\\bclass\\b|\\)\\s*\\{/.test(text) ? "the text of a function" : text;
}
function describe(value, depth = 0) {
  try {
    if (typeof value === "string") return JSON.stringify(value.slice(0, 40));
    if (typeof value === "symbol") return "symbol";
    if (typeof value === "bigint") return value + "n";
    if (typeof value === "function") return "function";
    if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);
    if (depth > 1) return "object";
    const keys = Reflect.ownKeys(value).filter(key => !/^(stack|line|column|sourceURL|originalLine|originalColumn)$/.test(String(key)));
    const parts = keys.slice(0, 12).map(key => {
      const found = Reflect.getOwnPropertyDescriptor(value, key);
      return String(key) + ":" + ("value" in found ? describe(found.value, depth + 1) : "accessor") + (found.writable ? "w" : "") + (found.enumerable ? "e" : "") + (found.configurable ? "c" : "");
    });
    const state = Object.isFrozen(value) ? " frozen" : Object.isSealed(value) ? " sealed" : Object.isExtensible(value) ? "" : " closed";
    return (Array.isArray(value) ? "array " : "object ") + keys.length + state + " {" + parts.join(", ") + "}";
  } catch (error) {
    return "threw " + error.name;
  }
}
`;

const ownFunction = `function (...rest) { log.push("own function, " + rest.length + " arguments"); return rest[0]; }`;
const ownClass = `class Own { constructor(...rest) { log.push("own class, " + rest.length + " arguments"); this.count = rest.length; } }`;
const otherBuiltIns = [
  "Array.prototype.slice",
  "Object.keys",
  "String",
  "Array.of",
  "Object.prototype.toString",
  "JSON.stringify",
  "Array.isArray",
];

/** Where the way keeps the built-in, if that place can be stored to. */
function holderOf(how: string): string | undefined {
  if (how === "as a member of a parsed object") return "box.run";
  if (how === "under a parsed name") return "box[parsedNames[0]]";
  if (
    how === "out of a parsed array" ||
    how === "with its operands out of a parsed array" ||
    how === "applied by Reflect out of a parsed array" ||
    how === "bound and kept in a parsed array"
  )
    return "held[0]";
}

/** Statements that run once, in the middle of the turns. */
function changeOf(random: Random, one: Case, how: string, declared: string[]): string {
  const choices: string[] = ["", "", "Bun.gc(true);"];
  const holder = holderOf(how);
  if (holder) {
    choices.push(
      `${holder} = ${one.isConstructed ? ownClass : ownFunction};`,
      `${holder} = ${one.isConstructed ? ownClass : ownFunction};`,
    );
    if (!one.isConstructed) choices.push(`${holder} = ${random.pick(otherBuiltIns)};`);
  }
  const named = method.exec(one.callee);
  if (named && one.receiver && declared.includes(one.receiver) && !one.isBorrowed) {
    choices.push(
      `Object.defineProperty(${one.receiver}, "${named[2]}", { value: ${ownFunction}, writable: true, configurable: true });`,
      `Object.setPrototypeOf(${one.receiver}, { __proto__: Object.getPrototypeOf(${one.receiver}), ${named[2]}(...rest) { log.push("method in between"); return super.${named[2]}(...rest); } });`,
      `Object.setPrototypeOf(${one.receiver}, null);`,
    );
  }
  const objects = [one.receiver, ...one.operands].filter((text): text is string => !!text && declared.includes(text));
  if (objects.length) {
    const target = random.pick(objects);
    choices.push(`${target}.added = "added";`);
    // Error.captureStackTrace defines `stack` anew whatever the object allows: what a frozen object answers behind it is not asked here.
    if (one.callee !== "Error.captureStackTrace")
      choices.push(`Object.freeze(${target});`, `Object.preventExtensions(${target});`);
    // Without its counter an iterator never ends.
    if (!/\+\+|\bnext\b/.test(one.setup)) choices.push(`delete ${target}[Reflect.ownKeys(${target})[0]];`);
  }
  return random.pick(choices);
}

function sceneOf(random: Random, index: number, one: Case, how: string, way: Way): string {
  const turns = calledSeldom.test(one.callee) ? random.between(1, 3) : random.pick([1, 2, 3, 12, 40, 150, 400]);
  const declared = [...one.setup.matchAll(/^(?:const|let) (\w+) =/gm)].map(found => found[1]);
  const change = turns > 1 ? changeOf(random, one, how, declared) : "";
  const middle = random.between(1, Math.max(1, turns - 1));
  const made = one.isConstructed ? way.construct(one) : way.call(one);
  const before = way.before?.(one) ?? "";
  const kept = /^const (held|box) /m.exec(before)?.[1];
  const step = `try {
      const result = ${one.isAwaited ? "await " : ""}${made};
      log.push(turn + " result " + withoutSourceText(${one.shown}));
    } catch (error) {
      log.push(turn + " threw " + error.name + ": " + withoutSourceText(error.message));
    }`;
  const inAFunction = random.chance(0.4);
  const waits = /\bawait\b/.test(step);
  return `async function scene${index}() {
  const log = new Log();
  const sums = { total: 0 };
${one.setup}${before}${kept && random.chance(0.5) ? `everything.push(${kept});\n` : ""}${inAFunction ? `  const step = ${waits ? "async " : ""}turn => {\n    ${step}\n  };\n` : ""}  for (let turn = 0; turn < ${turns}; turn++) {
${change ? `    if (turn === ${middle}) {\n      try {\n        ${change}\n        log.push("changed");\n      } catch (error) {\n        log.push("the change threw " + error.name);\n      }\n    }\n` : ""}    ${inAFunction ? `${waits ? "await " : ""}step(turn);` : step}
  }
${one.after ? `  try {\n    log.push("after " + withoutSourceText(${one.after}));\n  } catch (error) {\n    log.push("after threw " + error.name);\n  }\n` : ""}  log.push("total " + sums.total);
${(filledByChance.test(one.callee) ? [] : declared).map(name => `  log.push(${JSON.stringify(name + " ")} + describe(${name}));\n`).join("")}${way.behind ?? ""}  report(${JSON.stringify(`${one.name}, ${how}, ${turns} turns`)}, log);
}
`;
}

export function generate(random: Random): string {
  const count = random.pick([1, 1, 2, 3, 5]);
  const scenes: string[] = [];
  const calls: string[] = [];
  for (let index = 0; index < count; index++) {
    const one = random.pick(cases);
    const [how, way] = random.pick(Object.entries(ways).filter(([, each]) => each.fits?.(one) ?? true));
    scenes.push(sceneOf(random, index, one, how, way));
    for (let again = random.pick([1, 1, 1, 2, 3]); again > 0; again--) calls.push(`await scene${index}();`);
  }
  return `${helpers}${scenes.join("")}${(random.chance(0.3) ? random.shuffled(calls) : calls).join("\n")}
console.log("kept " + everything.length);
`;
}
