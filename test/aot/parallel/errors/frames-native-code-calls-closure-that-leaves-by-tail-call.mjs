// Names in frames where native code calls a renamed function object that leaves by a tail call into a plain function object of the same function, and the other way round.
const names = (stack, count) =>
  stack
    .split("\n")
    .slice(1, 1 + count)
    .map(line =>
      line
        .trim()
        .replace(/ ?\(.*\)$/, "")
        .replace(/^at /, "")
        .replace(/^.*\.mjs:.*$/, "module"),
    )
    .join(" < ");
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const rename = (f, name) => void (handedBack(f).displayName = name);
let last = "";
const make = () =>
  function plain(next) {
    if (typeof next === "function") return next();
    last = new Error("x").stack;
    return 0;
  };
const a = handedBack(make()),
  b = handedBack(make());
rename(a, "renamed");
const shown = run => {
  last = "";
  run();
  return names(last, 2);
};
for (const [label, first, second] of [
  ["renamed > plain", a, b],
  ["plain > renamed", b, a],
]) {
  console.log(
    label,
    "| sort |",
    shown(() => [second, second].sort(first)),
  );
  console.log(
    label,
    "| map |",
    shown(() => [second].map(first)),
  );
  console.log(
    label,
    "| forEach |",
    shown(() => [second].forEach(first)),
  );
  console.log(
    label,
    "| from |",
    shown(() => Array.from([second], first)),
  );
  console.log(
    label,
    "| Reflect.apply |",
    shown(() => Reflect.apply(first, undefined, [second])),
  );
  console.log(
    label,
    "| call |",
    shown(() => first.call(undefined, second)),
  );
  console.log(
    label,
    "| apply |",
    shown(() => first.apply(undefined, [second])),
  );
  console.log(
    label,
    "| bind |",
    shown(() => first.bind(undefined, second)()),
  );
  console.log(
    label,
    "| Map.forEach |",
    shown(() => new Map([[1, second]]).forEach(first)),
  );
  console.log(
    label,
    "| Set.forEach |",
    shown(() => new Set([second]).forEach(first)),
  );
  console.log(
    label,
    "| Promise |",
    shown(() => new Promise(first.bind(undefined, second))),
  );
  console.log(
    label,
    "| toJSON |",
    shown(() => JSON.stringify({ toJSON: first.bind(undefined, second) })),
  );
  console.log(
    label,
    "| getter |",
    shown(() => Object.defineProperty({}, "x", { get: first.bind(undefined, second) }).x),
  );
  console.log(
    label,
    "| proxy |",
    shown(() => new Proxy(first, {})(second)),
  );
  console.log(
    label,
    "| run-time code |",
    shown(() => new Function("f", "g", "return f(g);" + never)(first, second)),
  );
}
