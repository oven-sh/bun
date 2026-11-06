// A function makes a closure, a list or an object over its local variables and hands it to a callee, as a parameter or as
// an argument the callee has no parameter for. If the callee only borrows it, it need not outlive the caller's frame. Each
// scene picks a callee that ignores, calls, returns or keeps the value, openly or through `arguments`, a rest parameter, a
// forwarding call, a generator, an async function or a throw. The caller may end in a tail call. Afterwards other calls
// reuse the stack, and everything that was kept or returned is used and printed.
import type { Random } from "./random";

/** Callees. Each takes a number first. The lent value is the second argument, whether or not there is a parameter for it. */
const callees: Record<string, string> = {
  ignores: "function NAME(a) {\n  return a;\n}",
  ignoresParameter: "function NAME(a, lent) {\n  return a;\n}",
  uses: "function NAME(a, lent) {\n  return a + use(lent);\n}",
  returns: "function NAME(a, lent) {\n  return lent;\n}",
  keeps: "function NAME(a, lent) {\n  kept.push(lent);\n  return a;\n}",
  keepsSometimes: "function NAME(a, lent) {\n  if (a % 3 === 1) kept.push(lent);\n  return a;\n}",
  countsArguments: "function NAME(a) {\n  return arguments.length;\n}",
  keepsByArguments: "function NAME(a) {\n  kept.push(arguments[1]);\n  return a;\n}",
  returnsByArguments: "function NAME(a) {\n  return arguments[arguments.length - 1];\n}",
  keepsArguments: "function NAME(a) {\n  kept.push(arguments);\n  return a;\n}",
  keepsByRest: "function NAME(a, ...rest) {\n  kept.push(rest[0]);\n  return a;\n}",
  returnsRest: "function NAME(a, ...rest) {\n  return rest;\n}",
  keepsArrowOverArguments: "function NAME(a) {\n  kept.push(() => arguments[1]);\n  return a;\n}",
  forwardsByApply: "function NAME(a) {\n  return sink.apply(null, arguments);\n}",
  forwardsBySpread: "function NAME(...all) {\n  return sink(...all);\n}",
  forwardsAsSurplus: "function NAME(a, lent) {\n  return quiet(a, 0, lent);\n}",
  forwardsInTailCall: "function NAME(a, lent) {\n  return sink(a, lent);\n}",
  wraps: "function NAME(a, lent) {\n  return () => use(lent) + a;\n}",
  storesInObject: "function NAME(a, lent) {\n  holder.last = lent;\n  return a;\n}",
  storesInMap: "function NAME(a, lent) {\n  byNumber.set(a % 4, lent);\n  return a;\n}",
  throws: "function NAME(a, lent) {\n  throw lent;\n}",
  throwsByArguments: "function NAME(a) {\n  throw arguments[1];\n}",
  isGenerator: "function* NAME(a, lent) {\n  yield a;\n  yield use(lent);\n}",
  isGeneratorWithoutParameter: "function* NAME(a) {\n  yield a;\n  yield use(arguments[1]);\n}",
  isAsync: "async function NAME(a, lent) {\n  await null;\n  kept.push(use(lent));\n  return a;\n}",
  isAsyncWithoutParameter: "async function NAME(a) {\n  await null;\n  kept.push(arguments[1]);\n  return a;\n}",
  isConstructor: "function NAME(a, lent) {\n  this.a = a;\n  this.lent = lent;\n}",
  hasDefault: "function NAME(a, lent = 0, more = lent) {\n  kept.push(more);\n  return a;\n}",
};

/** Expressions that make the value over the caller's variables `x` and `local`. */
const values = [
  "() => local + x",
  "() => local + x",
  "function () {\n    return local + x;\n  }",
  "() => ++local",
  "() => () => local + x",
  "[local, x]",
  "[() => local, x]",
  "{ local, x }",
  "{ read: () => local + x }",
  "{\n    read() {\n      return local + x;\n    },\n  }",
];

/** Calls of CALLEE with `x` and `lent`. */
const calls = [
  "CALLEE(x, lent)",
  "CALLEE(x, lent)",
  "CALLEE(x, lent, 1)",
  "CALLEE.call(null, x, lent)",
  "CALLEE.apply(null, [x, lent])",
  "Reflect.apply(CALLEE, null, [x, lent])",
  "CALLEE(...[x, lent])",
  "CALLEE.bind(null, x)(lent)",
  "table[x % table.length](x, lent)",
  "(0, CALLEE)(x, lent)",
];

/** How the caller ends. `answer` is what the callee returned. */
const ends = [
  "return answer;",
  "return answer;",
  "return last(answer);",
  "return last(answer, lent);",
  "return quiet(answer, lent);",
  "return sink(answer, lent);",
  'return typeof answer === "function" ? answer() : answer;',
  "return [answer, local];",
  "return last(() => answer);",
];

export function generate(random: Random): string {
  const names = random.sample(Object.keys(callees), random.between(3, 6));
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const callee = random.pick(names);
    const called = random.pick(calls).replaceAll("CALLEE", callee);
    const call = callee === "isConstructor" && called.startsWith(callee + "(") ? `new ${called}` : called;
    const times = random.pick([1, 1, 3, 300]);
    scenes.push(`function caller${scene}(x) {
  let local = x * 2;
  const lent = ${random.pick(values)};
  let answer;
  try {
    answer = ${call};
  } catch (thrown) {
    answer = thrown;
  }
  ${random.pick(["", "", "local++;", "local += 10;"])}
  ${random.pick(ends)}
}
{
  const results = [];
  for (let x = 0; x < ${times}; x++) {
    const result = told(() => caller${scene}(x));
    if (x < 2 || x === ${times - 1}) results.push(result);
  }
  scribble(40);
  await settle();
  console.log("scene ${scene}", results.map(shown).join(" | "), "kept", kept.length, kept.slice(0, 3).concat(kept.slice(-2)).map(shown).join(" | "));
  console.log("scene ${scene} held", shown(holder.last), [...byNumber.values()].map(shown).join(" | "));
  kept.length = 0;
}`);
  }
  return `const kept = [];
const holder = { last: undefined };
const byNumber = new Map();
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return error instanceof Error ? "threw " + error.name : error;
  }
}
// Uses a lent value whatever it is.
function use(lent) {
  if (typeof lent === "function") {
    const answer = lent();
    return typeof answer === "function" ? answer() : answer;
  }
  if (Array.isArray(lent)) return use(lent[0]) + lent.length;
  if (lent && typeof lent.read === "function") return lent.read();
  if (lent && typeof lent === "object" && "local" in lent) return lent.local + lent.x;
  return lent;
}
function shown(value, depth = 0) {
  if (depth > 3) return "deep";
  if (typeof value === "function") return "function " + shown(told(value), depth + 1);
  if (value && typeof value.next === "function") return "steps " + [...value].map(step => shown(step, depth + 1)).join("+");
  if (value && typeof value.then === "function") return "promise";
  if (value && typeof value === "object" && "length" in value) return "list " + Array.from(value, item => shown(item, depth + 1)).join("+");
  if (value && typeof value === "object") return "object " + Object.keys(value).join("+") + " " + shown(told(() => use(value.lent ?? value)), depth + 1);
  return String(value);
}
// Runs over the part of the stack that the callers used.
function scribble(depth) {
  const filler = [depth, depth + 1, depth + 2, () => depth];
  return depth > 0 ? scribble(depth - 1) + filler.length + filler[3]() : 0;
}
async function settle() {
  for (let tick = 0; tick < 4; tick++) await null;
}
function sink(a, lent) {
  kept.push(lent);
  return a;
}
function quiet(a) {
  return a;
}
function last(answer) {
  return answer;
}
${names.map(name => callees[name].replace("NAME", name)).join("\n")}
const table = [${names.filter(name => name !== "isConstructor").join(", ")}];
${scenes.join("\n")}
`;
}
