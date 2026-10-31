// Prints the frames of an error that an async generator throws behind an `await`, with and without other jobs in the queue.
function fail() {
  throw new Error("fail");
}
const inThisFile = /frames-above-async-generators-waited/;
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /^\s*at (.*?) ?\(?[^ ()]*:(\d+:\d+)\)?$/.exec(line))
    .map(found => `${found[1]}@${found[2]}`)
    .join(" < ");
}
function sitesHere() {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, sites) =>
    sites
      .filter(site => inThisFile.test(String(site.getFileName())))
      .map(
        site =>
          `${site.isAsync() ? "async " : ""}${site.getFunctionName()}@${site.getLineNumber()}:${site.getColumnNumber()}`,
      )
      .join(" < ");
  const holder = {};
  Error.captureStackTrace(holder);
  const text = holder.stack;
  Error.prepareStackTrace = before;
  return text;
}
async function show(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", framesOf(error));
  }
}
async function* work() {
  yield 1;
  await null;
  fail();
}
async function* workAtOnce() {
  fail();
}
async function* workThatLooks() {
  yield 1;
  await null;
  console.log("call sites |", sitesHere());
  yield 2;
}
async function* outer() {
  for await (const value of work()) yield value;
}
async function total(values) {
  let sum = 0;
  for await (const value of values) sum += value;
  return sum;
}
async function scenario() {
  return await total(work());
}
async function steppedByItsCaller() {
  let sum = 0;
  for await (const value of work()) sum += value;
  return sum;
}
async function steppedByHand() {
  const iterator = work();
  await iterator.next();
  await iterator.next();
}
async function failsBehindTheLoop() {
  let sum = 0;
  for await (const value of workThatLooks()) sum += value;
  fail();
}
async function unrelated() {
  for (let i = 0; i < 20; i++) await null;
}
async function callsUnrelated() {
  await unrelated();
}
await show("stepped by another function", scenario);
await show("thrown at once", () => total(workAtOnce()));
await show("stepped by its caller", steppedByItsCaller);
await show("stepped by hand", steppedByHand);
await total(workThatLooks());
await show("a generator that steps a generator", () => total(outer()));
await show("behind the loop", failsBehindTheLoop);
const other = callsUnrelated();
await show("beside another chain of async functions", scenario);
await other;
