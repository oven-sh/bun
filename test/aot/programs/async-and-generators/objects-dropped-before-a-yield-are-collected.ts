// Each generator makes an object, drops it, and then collects after every step.
const registry = new FinalizationRegistry<() => void>(markCollected => markCollected());
const maxRounds = 300;

function readName(value: { name: string }) {
  return value.name.length;
}

function* collectAfterEachYield(names: string[], markCollected: () => void) {
  const value = { name: names.join("-") };
  registry.register(value, markCollected);
  let total = 0;
  for (const name of names) total += readName(value) + name.length;
  yield total;
  for (;;) {
    Bun.gc(true);
    yield 0;
  }
}

async function* collectAfterEachAsyncYield(names: string[], markCollected: () => void) {
  const blob = new Blob(names);
  registry.register(blob, markCollected);
  yield blob.size + blob.slice(1).size;
  for (;;) {
    Bun.gc(true);
    yield 0;
  }
}

async function stepGenerator() {
  let isCollected = false;
  const steps = collectAfterEachYield(["a", "bc", "def"], () => void (isCollected = true));
  console.log(steps.next().value);
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    steps.next();
    await Bun.sleep(0);
  }
  console.log("a local of a generator:", isCollected ? "collected" : "still held");
}

async function stepAsyncGenerator() {
  let isCollected = false;
  const steps = collectAfterEachAsyncYield(["gh", "i"], () => void (isCollected = true));
  console.log((await steps.next()).value);
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    await steps.next();
    await Bun.sleep(0);
  }
  console.log("a local of an async generator:", isCollected ? "collected" : "still held");
}

await stepGenerator();
await stepAsyncGenerator();
