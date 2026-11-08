// Error.captureStackTrace(target, fn) leaves out the frames down to fn. Here frames of built-in functions lie on the stack, and fn is a function made at run time that is not on the stack, a built-in that is, or a built-in that is not.
const frames = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.mjs:.*$/, "module"),
    )
    .join(" < ") || "nothing";
const never = process.argv.length > 1000 ? "x" : "";
const madeAtRunTime = new Function("return 1;" + never);
let upTo;
let shown = "";
function capture() {
  const target = {};
  Error.captureStackTrace(target, upTo);
  shown = frames(target.stack);
  return 0;
}
const ways = {
  stringify: () => JSON.stringify({ toJSON: capture }),
  replace: () => "x".replace("x", capture),
  replaceAll: () => "x".replaceAll("x", capture),
  from: () => Array.from([1], capture),
  sort: () => [2, 1].sort(capture),
  apply: () => Reflect.apply(capture, undefined, []),
  construct: () =>
    Reflect.construct(function () {
      capture();
    }, []),
  groupBy: () => Object.groupBy([1], capture),
  fromEntries: () => Object.fromEntries({ [Symbol.iterator]: () => ({ next: () => (capture(), { done: true }) }) }),
  forEach: () => new Map([[1, 1]]).forEach(capture),
  reduce: () => [1, 2].reduce(capture),
  max: () => Math.max({ valueOf: capture }),
};
for (const [name, run] of Object.entries(ways)) {
  upTo = madeAtRunTime;
  run();
  console.log(name, "| up to a function that is not there |", shown);
}
const builtins = {
  stringify: JSON.stringify,
  replace: String.prototype.replace,
  from: Array.from,
  sort: Array.prototype.sort,
  apply: Reflect.apply,
  groupBy: Object.groupBy,
  forEach: Map.prototype.forEach,
  reduce: Array.prototype.reduce,
  max: Math.max,
};
for (const [name, builtin] of Object.entries(builtins)) {
  upTo = builtin;
  ways[name]();
  console.log(name, "| up to the built-in itself |", shown);
  upTo = name === "max" ? Math.min : Math.max;
  ways[name]();
  console.log(name, "| up to another built-in |", shown);
}
