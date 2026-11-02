// An async function, a generator and an async generator, each started by four functions that do not wait, in a program that is compiled as a very large one. Each line: the sums of a thousand turns.
// Flags: --aot-limit=MaxWarmCodeValues:1
interface Entry { id: number; name: string; weight: number; tags: string[] }

function makeEntry(id: number): Entry {
  return { id, name: "entry-" + (id & 7), weight: (id * 31) & 1023, tags: ["a", "b", id & 1 ? "odd" : "even"] };
}
function scoreOf(entry: Entry): number { return entry.weight * 3 + entry.name.length + entry.tags.length; }
function isOdd(entry: Entry): boolean { return entry.tags[2] === "odd"; }

let settled = 0;

async function weigh(entry: Entry, gate: Promise<number> | number): Promise<number> {
  let sum = scoreOf(entry);
  if (isOdd(entry)) sum += entry.id & 15;
  const bias = await gate;
  sum += bias + scoreOf(entry);
  if (!isOdd(entry)) sum ^= entry.weight;
  settled++;
  return sum;
}
function* spread(entry: Entry): Generator<number, void, void> {
  yield scoreOf(entry);
  if (isOdd(entry)) yield entry.id & 15;
  yield entry.weight + scoreOf(entry);
}
async function* trickle(entry: Entry, gate: number): AsyncGenerator<number, void, void> {
  yield scoreOf(entry);
  const bias = await gate;
  if (isOdd(entry)) yield bias + (entry.id & 15);
  yield entry.weight + scoreOf(entry);
}

function first(entry: Entry): Promise<number> { return weigh(entry, 1); }
function second(entry: Entry): Promise<number> { return weigh(entry, Promise.resolve(2)); }
function third(entry: Entry): Promise<number> { return weigh(entry, 3); }
function fourth(entry: Entry): Promise<number> { return weigh(entry, 4); }

function drain(numbers: Generator<number, void, void>): number {
  let sum = 0;
  for (const number of numbers) sum += number;
  return sum;
}
function firstSpread(entry: Entry): number { return drain(spread(entry)) + 1; }
function secondSpread(entry: Entry): number { return drain(spread(entry)) + 2; }
function thirdSpread(entry: Entry): number { return drain(spread(entry)) + 3; }
function fourthSpread(entry: Entry): number { return drain(spread(entry)) + 4; }

function firstTrickle(entry: Entry): AsyncGenerator<number, void, void> { return trickle(entry, 1); }
function secondTrickle(entry: Entry): AsyncGenerator<number, void, void> { return trickle(entry, 2); }
function thirdTrickle(entry: Entry): AsyncGenerator<number, void, void> { return trickle(entry, 3); }
function fourthTrickle(entry: Entry): AsyncGenerator<number, void, void> { return trickle(entry, 4); }

let awaited = 0;
let spreadOut = 0;
let trickled = 0;
for (let turn = 0; turn < 1000; turn++) {
  const entry = makeEntry(turn);
  awaited = (awaited + (await first(entry)) + (await second(entry)) + (await third(entry)) + (await fourth(entry))) | 0;
  spreadOut = (spreadOut + firstSpread(entry) + secondSpread(entry) + thirdSpread(entry) + fourthSpread(entry)) | 0;
  for (const numbers of [firstTrickle(entry), secondTrickle(entry), thirdTrickle(entry), fourthTrickle(entry)]) {
    for await (const number of numbers) trickled = (trickled + number) | 0;
  }
}
console.log("async functions", awaited, settled);
console.log("generators", spreadOut);
console.log("async generators", trickled);
