// `new forward(x)` where forward only hands its arguments on to another function: the innermost frame of a trace taken there names that function, without `new`.
// In a function so large that the compiler stops removing allocations in it, the call is made by another road. The number is lowered here so that a small function is that large.
import { generated } from "./generated/run-generated";

const text = `
function target(value) {
  let frame = "none";
  for (const line of new Error("trace").stack.split("\\n")) {
    const match = /^\\s+at ((?:new )?[\\w$]+) \\(/.exec(line);
    if (match) { frame = match[1]; break; }
  }
  return { value, frame };
}
function forward(value) { return target(value); }
function forwardTwice(value) { return forward(value); }
for (const callee of [target, forward, forwardTwice])
  console.log(callee.name, callee(1).frame, "|", new callee(1).frame, "|", Reflect.construct(callee, [1]).frame);
`;

generated(
  "a constructor that only hands on, in a very large function",
  ["MaxSinkingWork", "MaxWarmCodeValues", "MaxOptimizationWork"].map(limit => ({
    name: `${limit}.`,
    isAlwaysRun: true,
    isOnlyCompiled: true as const,
    flags: [`--aot-limit=${limit}:2`],
    failsToday: "the frame reads `new target`",
    make: () => ({ file: "main.js", text }),
  })),
);

// The trace of the TypeError that a native method throws for a frozen list starts with the frame of that method.
const frozen = (method: string, list = "Object.freeze([1, 2])") => `
const framesOf = error => error.stack.split("\\n").slice(1).map(line => /at (\\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
const frozen = ${list};
function mine(list, x) { return list.${method}(x); }
function run(f) { try { f(frozen, 1); } catch (error) { console.log(error.constructor.name, framesOf(error)); } }
run(mine);
try { frozen.${method}(1); } catch (error) { console.log(framesOf(error)); }
`;
generated(
  "the frames of a native method that refuses a frozen list",
  ["push", "unshift", "pop", "shift", "fill", "reverse", "splice", "sort"].map(method => ({
    name: `${method}.`,
    isAlwaysRun: method === "push" || method === "pop",
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: frozen(method) }),
  })),
);
generated(
  "the frames of push where a list refuses one more element",
  Object.entries({
    "sealed": "Object.seal([1, 2])",
    "not extensible": "Object.preventExtensions([1, 2])",
    "of a fixed length": 'Object.defineProperty([1, 2], "length", { writable: false })',
    "frozen, of numbers that are no integers": "Object.freeze([1.5, 2.5])",
    "frozen, of texts": 'Object.freeze(["a", "b"])',
    "frozen, empty": "Object.freeze([])",
    "frozen, with a hole": "Object.freeze([1, , 3])",
  }).map(([name, list]) => ({
    name: `${name}.`,
    isAlwaysRun: true,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: frozen("push", list) }),
  })),
);
