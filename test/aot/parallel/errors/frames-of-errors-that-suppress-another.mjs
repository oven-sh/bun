// Prints which functions the stack of a SuppressedError lists: the one that holds the `using` declaration and its callers.
function fail() {
  throw new Error("fail");
}
const inThisFile = /frames-of-errors-that-suppress-another/;
function functionsOf(error) {
  return String(error.stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /^\s*at (?:(.*?) \()?/.exec(line)[1] ?? "the module")
    .join(" < ");
}
async function show(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", functionsOf(error));
    console.log(label, "| error |", functionsOf(error.error), "| suppressed |", functionsOf(error.suppressed));
  }
}
function holds() {
  using first = { [Symbol.dispose]: () => fail() };
  fail();
}
function holdsInBlock() {
  {
    using first = { [Symbol.dispose]: () => fail() };
    fail();
  }
}
function holdsTwo() {
  using first = { [Symbol.dispose]: () => fail() };
  using second = { [Symbol.dispose]: () => fail() };
}
async function holdsAsync() {
  await using first = { [Symbol.asyncDispose]: async () => fail() };
  fail();
}
function calls() {
  holds();
  return 1;
}
await show("in a function", holds);
await show("in a block", holdsInBlock);
await show("two resources", holdsTwo);
await show("await using", holdsAsync);
await show("under a caller", calls);
