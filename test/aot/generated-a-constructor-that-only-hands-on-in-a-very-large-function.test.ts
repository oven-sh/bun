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
const frozen = (method: string) => `
const framesOf = error => error.stack.split("\\n").slice(1).map(line => /at (\\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
const frozen = Object.freeze([1, 2]);
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
    failsToday: method === "push" ? "the frame of push is missing" : undefined,
    make: () => ({ file: "main.js", text: frozen(method) }),
  })),
);
