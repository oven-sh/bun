// Each function makes an object, drops it, and then collects in a loop that awaits.
const registry = new FinalizationRegistry<() => void>(markCollected => markCollected());
const maxRounds = 300;
let rounds = 0;

function report(label: string, isCollected: boolean) {
  console.log(label + ":", isCollected ? "collected" : "still held");
}

function readName(value: { name: string }) {
  return value.name.length;
}

async function passToNativeCalls() {
  let isCollected = false;
  const stream = (() => {
    const blob = new Blob(["one", "two", "three"]);
    registry.register(blob, () => void (isCollected = true));
    return blob.stream();
  })();
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("an argument of native calls", isCollected);
  return stream;
}

async function keepOverCalls(names: string[]) {
  let isCollected = false;
  let total = 0;
  let value: { name: string } | null = { name: names.join("-") };
  registry.register(value, () => void (isCollected = true));
  for (const name of names) total += readName(value) + name.length;
  value = null;
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("a local kept over calls", isCollected);
  return total;
}

async function countRoundsOutside() {
  let isCollected = false;
  const blob = new Blob(["four", "five"]);
  registry.register(blob, () => void (isCollected = true));
  const size = blob.size + blob.type.length + blob.slice(1).size;
  rounds = 0;
  while (!isCollected && rounds++ < maxRounds) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("a local used by several calls in a row", isCollected);
  return size;
}

async function holdInAShortLivedObject(names: string[]) {
  let isCollected = false;
  const inner = { name: names.join("+") };
  registry.register(inner, () => void (isCollected = true));
  const pair = { first: inner, second: inner };
  const length = readName(pair.first) + readName(pair.second);
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("a member of an object that never leaves the function", isCollected);
  return length;
}

async function awaitFirst(names: string[]) {
  let isCollected = false;
  await Bun.sleep(0);
  const value = { name: names.join("/") };
  registry.register(value, () => void (isCollected = true));
  const length = readName(value);
  for (let round = 0; !isCollected && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("an object made after the first await", isCollected);
  return length;
}

async function handleRequests(count: number) {
  let collected = 0;
  for (let index = 0; index < count; index++) {
    const request = await Promise.resolve({ name: "request " + index });
    registry.register(request, () => void collected++);
    readName(request);
    Bun.gc(true);
  }
  for (let round = 0; collected < count && round < maxRounds; round++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  report("every request of a loop that awaits the next one", collected === count);
}

console.log(await Bun.readableStreamToText(await passToNativeCalls()));
console.log(await keepOverCalls(["a", "bc", "def"]));
console.log(await countRoundsOutside());
console.log(await holdInAShortLivedObject(["x", "y"]));
console.log(await awaitFirst(["p", "q"]));
await handleRequests(20);
