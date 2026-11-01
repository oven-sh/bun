// Prints the names that stack frames show where a function object with a displayName given out of the compiler's sight leaves by a tail call into a plain function object of the same function, and the other way round.
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
  b = handedBack(make()),
  c = handedBack(make());
rename(a, "renamed");
const shown = run => {
  last = "";
  run();
  return names(last, 2);
};
function byValue(f, g) {
  f(g);
}
console.log(
  "plain > plain |",
  shown(() => byValue(b, c)),
);
console.log(
  "renamed alone |",
  shown(() => byValue(a, undefined)),
);
for (const [label, first, second] of [
  ["renamed > plain", a, b],
  ["plain > renamed", b, a],
]) {
  console.log(
    label,
    "| by value |",
    shown(() => byValue(first, second)),
  );
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
    "| getter |",
    shown(() => Object.defineProperty({}, "x", { get: first.bind(undefined, second) }).x),
  );
  console.log(
    label,
    "| proxy |",
    shown(() => new Proxy(first, {})(second)),
  );
}
function direct() {
  const f = make(),
    g = make();
  rename(f, "made here");
  return [shown(() => f(g)), shown(() => g(f)), shown(() => f())].join(" | ");
}
console.log("direct |", direct());
