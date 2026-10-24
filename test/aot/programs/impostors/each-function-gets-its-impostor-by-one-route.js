import { EventEmitter } from "node:events";

const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

class Plot {
  constructor(wide, deep) {
    this.wide = wide;
    this.deep = deep;
  }
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

function callWith(callee, input) {
  return callee(input);
}

function measuredThroughAPlainCall(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughCall(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughApply(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughBind(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughBindLater(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughReflectApply(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughASpread(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughMap(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughArrayFrom(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughFind(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughFlatMap(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughSetForEach(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAComparator(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAReplacer(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAField(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAJoinedName(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAnElement(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAParameter(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAGetter(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughValueOf(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAReviver(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughToJson(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAReaction(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAnAwait(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAGenerator(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughATrap(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughACallableProxy(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughATag(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAMicrotask(plot) {
  return plot.wide * plot.deep;
}

function measuredThroughAListener(plot) {
  return plot.wide * plot.deep;
}

const rows = [
  ["a plain call", () => measuredThroughAPlainCall(new Plot(3, 4)), plot => measuredThroughAPlainCall(plot)],
  ["call", () => measuredThroughCall(new Plot(3, 4)), plot => measuredThroughCall.call(null, plot)],
  ["apply", () => measuredThroughApply(new Plot(3, 4)), plot => measuredThroughApply.apply(null, [plot])],
  ["bind", () => measuredThroughBind(new Plot(3, 4)), plot => measuredThroughBind.bind(null, plot)()],
  ["bind without arguments", () => measuredThroughBindLater(new Plot(3, 4)), plot => measuredThroughBindLater.bind(null)(plot)],
  ["Reflect.apply", () => measuredThroughReflectApply(new Plot(3, 4)), plot => Reflect.apply(measuredThroughReflectApply, null, [plot])],
  ["a spread call", () => measuredThroughASpread(new Plot(3, 4)), plot => measuredThroughASpread(...[plot])],
  ["map", () => measuredThroughMap(new Plot(3, 4)), plot => [plot].map(measuredThroughMap)[0]],
  ["Array.from with a mapper", () => measuredThroughArrayFrom(new Plot(3, 4)), plot => Array.from([plot], measuredThroughArrayFrom)[0]],
  ["find", () => measuredThroughFind(new Plot(3, 4)), plot => [[plot].find(measuredThroughFind) === plot]],
  ["flatMap", () => measuredThroughFlatMap(new Plot(3, 4)), plot => [plot].flatMap(measuredThroughFlatMap)[0]],
  ["forEach of a Set", () => measuredThroughSetForEach(new Plot(3, 4)), plot => { let result; new Set([plot]).forEach(each => { result = measuredThroughSetForEach(each); }); return result; }],
  ["a sort comparator", () => measuredThroughAComparator(new Plot(3, 4)), plot => { let result; [plot, plot].sort(first => ((result = measuredThroughAComparator(first)), 0)); return result; }],
  ["a replace callback", () => measuredThroughAReplacer(new Plot(3, 4)), plot => "x".replace("x", () => measuredThroughAReplacer(plot))],
  ["a field", () => measuredThroughAField(new Plot(3, 4)), plot => ({ measure: measuredThroughAField }).measure(plot)],
  ["a field under a joined name", () => measuredThroughAJoinedName(new Plot(3, 4)), plot => ({ measure: measuredThroughAJoinedName })[["mea", "sure"].join("")](plot)],
  ["an element", () => measuredThroughAnElement(new Plot(3, 4)), plot => [measuredThroughAnElement][0](plot)],
  ["a parameter", () => measuredThroughAParameter(new Plot(3, 4)), plot => callWith(measuredThroughAParameter, plot)],
  ["a getter", () => measuredThroughAGetter(new Plot(3, 4)), plot => ({ get result() { return measuredThroughAGetter(plot); } }).result],
  ["valueOf", () => measuredThroughValueOf(new Plot(3, 4)), plot => +{ valueOf: () => measuredThroughValueOf(plot) }],
  ["a reviver", () => measuredThroughAReviver(new Plot(3, 4)), plot => JSON.parse("1", () => measuredThroughAReviver(plot))],
  ["toJSON", () => measuredThroughToJson(new Plot(3, 4)), plot => JSON.parse(JSON.stringify({ toJSON: () => measuredThroughToJson(plot) }))],
  ["a promise reaction", () => measuredThroughAReaction(new Plot(3, 4)), plot => Promise.resolve(plot).then(measuredThroughAReaction)],
  ["an async function", () => measuredThroughAnAwait(new Plot(3, 4)), plot => (async () => measuredThroughAnAwait(await plot))()],
  ["a generator", () => measuredThroughAGenerator(new Plot(3, 4)), plot => (function* () { yield measuredThroughAGenerator(plot); })().next().value],
  ["a proxy trap", () => measuredThroughATrap(new Plot(3, 4)), plot => new Proxy({}, { get: () => measuredThroughATrap(plot) }).anything],
  ["a callable proxy", () => measuredThroughACallableProxy(new Plot(3, 4)), plot => new Proxy(measuredThroughACallableProxy, {})(plot)],
  ["a tagged template", () => measuredThroughATag(new Plot(3, 4)), plot => ((strings, each) => measuredThroughATag(each))`${plot}`],
  ["a microtask", () => measuredThroughAMicrotask(new Plot(3, 4)), plot => new Promise(resolve => queueMicrotask(() => resolve(measuredThroughAMicrotask(plot))))],
  ["a listener", () => measuredThroughAListener(new Plot(3, 4)), plot => { let result; const emitter = new EventEmitter(); emitter.on("plot", each => { result = measuredThroughAListener(each); }); emitter.emit("plot", plot); return result; }],
];

let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += measuredThroughAPlainCall(new Plot(i % 7, 2));
  sum += measuredThroughCall(new Plot(i % 7, 2));
  sum += measuredThroughApply(new Plot(i % 7, 2));
  sum += measuredThroughBind(new Plot(i % 7, 2));
  sum += measuredThroughBindLater(new Plot(i % 7, 2));
  sum += measuredThroughReflectApply(new Plot(i % 7, 2));
  sum += measuredThroughASpread(new Plot(i % 7, 2));
  sum += measuredThroughMap(new Plot(i % 7, 2));
  sum += measuredThroughArrayFrom(new Plot(i % 7, 2));
  sum += measuredThroughFind(new Plot(i % 7, 2));
  sum += measuredThroughFlatMap(new Plot(i % 7, 2));
  sum += measuredThroughSetForEach(new Plot(i % 7, 2));
  sum += measuredThroughAComparator(new Plot(i % 7, 2));
  sum += measuredThroughAReplacer(new Plot(i % 7, 2));
  sum += measuredThroughAField(new Plot(i % 7, 2));
  sum += measuredThroughAJoinedName(new Plot(i % 7, 2));
  sum += measuredThroughAnElement(new Plot(i % 7, 2));
  sum += measuredThroughAParameter(new Plot(i % 7, 2));
  sum += measuredThroughAGetter(new Plot(i % 7, 2));
  sum += measuredThroughValueOf(new Plot(i % 7, 2));
  sum += measuredThroughAReviver(new Plot(i % 7, 2));
  sum += measuredThroughToJson(new Plot(i % 7, 2));
  sum += measuredThroughAReaction(new Plot(i % 7, 2));
  sum += measuredThroughAnAwait(new Plot(i % 7, 2));
  sum += measuredThroughAGenerator(new Plot(i % 7, 2));
  sum += measuredThroughATrap(new Plot(i % 7, 2));
  sum += measuredThroughACallableProxy(new Plot(i % 7, 2));
  sum += measuredThroughATag(new Plot(i % 7, 2));
  sum += measuredThroughAMicrotask(new Plot(i % 7, 2));
  sum += measuredThroughAListener(new Plot(i % 7, 2));
}
console.log("2000 honest calls each", sum);

for (const [label, measureHonestly, reach] of rows) {
  let line = label + " | an impostor -> ";
  try {
    line += show(await reach(makeImpostor()));
  } catch (error) {
    line += "threw " + error.constructor.name;
  }
  console.log(line + " | log " + log.splice(0).join(", "));
  console.log(label + " | honest again -> " + show(measureHonestly()));
}
