// A function that reads members has honest and lookalikes callers.
const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

async function print(label, run) {
  let line;
  try {
    line = label + " -> " + show(await run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

class Plot {
  constructor(wide, deep) {
    this.wide = wide;
    this.deep = deep;
  }
}

function honestFirst(plot) {
  return plot.wide * plot.deep;
}

function impostorFirst(plot) {
  return plot.wide * plot.deep;
}

function makeImpostor() {
  return {
    get deep() {
      log.push("get deep");
      return "4";
    },
    get wide() {
      log.push("get wide");
      return { valueOf() { log.push("valueOf of wide"); return 3; } };
    },
  };
}

function callers(measure) {
  const holder = { measure, list: [measure] };
  const name = ["mea", "sure"].join("");
  return [
    ["a plain call", plot => measure(plot)],
    ["call", plot => measure.call(null, plot)],
    ["apply", plot => measure.apply(null, [plot])],
    ["bind", plot => measure.bind(null, plot)()],
    ["bind without arguments", plot => measure.bind(null)(plot)],
    ["Reflect.apply", plot => Reflect.apply(measure, null, [plot])],
    ["a spread call", plot => measure(...[plot])],
    ["map", plot => [plot].map(measure)[0]],
    ["forEach with a closure", plot => { let result; [plot].forEach(each => { result = measure(each); }); return result; }],
    ["Array.from with a mapper", plot => Array.from([plot], measure)[0]],
    ["reduce", plot => [plot].reduce((sum, each) => sum + measure(each), 0)],
    ["a sort comparator", plot => { let result; [1, 2].sort(() => ((result = measure(plot)), 0)); return result; }],
    ["a replace callback", plot => "x".replace("x", () => measure(plot))],
    ["a field", plot => holder.measure(plot)],
    ["a field under a computed name", plot => holder[name](plot)],
    ["an element", plot => holder.list[0](plot)],
    ["a parameter", plot => (callee => callee(plot))(measure)],
    ["a getter", plot => ({ get result() { return measure(plot); } }).result],
    ["valueOf", plot => +{ valueOf: () => measure(plot) }],
    ["a reviver", plot => JSON.parse("1", () => measure(plot))],
    ["toJSON", plot => JSON.parse(JSON.stringify({ toJSON: () => measure(plot) }))],
    ["a promise reaction", plot => Promise.resolve(plot).then(measure)],
    ["an async function", async plot => measure(await plot)],
    ["a generator", plot => (function* () { yield measure(plot); })().next().value],
    ["a proxy trap", plot => new Proxy({}, { get: () => measure(plot) }).anything],
    ["a callable proxy", plot => new Proxy(measure, {})(plot)],
    ["new", plot => typeof new measure(plot)],
    ["a tagged template", plot => ((strings, each) => measure(each))`${plot}`],
    ["hidden code", plot => new Function("measure", "plot", "return measure(plot);")(measure, plot)],
    ["indirect eval", plot => (0, eval)("(function (measure, plot) { return measure(plot); })")(measure, plot)],
    ["hidden code that uses call", plot => new Function("measure", "plot", "return measure.call(undefined, plot);")(measure, plot)],
  ];
}

for (let i = 0; i < 2000; i++) honestFirst(new Plot(i % 7, 2));
for (const [label, caller] of callers(honestFirst)) {
  await print("2000 honest calls first | " + label + " | an impostor", () => caller(makeImpostor()));
  await print("2000 honest calls first | " + label + " | honest", () => caller(new Plot(3, 4)));
}

for (const [label, caller] of callers(impostorFirst)) {
  await print("no honest call before | " + label + " | an impostor", () => caller(makeImpostor()));
  await print("no honest call before | " + label + " | honest", () => caller(new Plot(3, 4)));
}

for (const [label, caller] of callers(honestFirst)) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const result = await caller(new Plot(i % 5, 2));
    sum += typeof result === "number" ? result : 0;
  }
  await print("300 honest calls through " + label + " give " + sum + ", then an impostor", () => caller(makeImpostor()));
}
