const show = value =>
  Object.is(value, -0)
    ? "-0"
    : typeof value === "string" || (typeof value === "object" && value !== null)
      ? JSON.stringify(value)
      : String(value);
const report = (label, probe) => {
  let text;
  try {
    text = show(probe());
  } catch (error) {
    text = "threw " + error.constructor.name;
  }
  console.log(label + ": " + text);
};
const log = [];
const note = entry => {
  log.push(entry);
};
const make = new Function("log", "return function*() { try { yield 1; yield 2; } finally { log('f'); } }");
function* written() {
  try {
    yield 1;
    yield 2;
  } finally {
    note("f");
  }
}
function resume(generatorFunction, resumeOnce) {
  log.length = 0;
  const g = generatorFunction(),
    steps = [g.next()];
  try {
    steps.push(resumeOnce(g));
  } catch (error) {
    steps.push("threw " + error.constructor.name);
  }
  steps.push(log.join(), g.next(), log.join());
  return steps;
}
for (const [kind, generatorFunction] of [
  ["text", make(note)],
  ["written", written],
]) {
  report(kind + ": return", () => resume(generatorFunction, g => g.return(7)));
  report(kind + ": throw", () => resume(generatorFunction, g => g.throw(new RangeError("x"))));
  report(kind + ": next", () => resume(generatorFunction, g => g.next()));
}
