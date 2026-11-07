// A callback dies with the call it is handed to, and what it captures does not: the callee or the callback itself keeps, returns, throws or stores it.
// Each mapper below has one callback, so that the callback may be laid into a copy of the mapper, which then reads the captures out of the closure.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

// Overwrites what earlier frames have left on the stack.
function trample(depth: number, a: number, b: number, c: number): number {
  const d = a * 3 + depth, e = b * 5 + depth, f = c * 7 + depth, g = d ^ e, h = e ^ f, i = f ^ d;
  if (depth === 0) return d + e + f + g + h + i;
  return trample(depth - 1, g, h, i) + d - e + f - g + h - i;
}

interface Item { flags: number; members: Item[] | undefined; name: string }
function leaf(name: string): Item { return { flags: 1, members: undefined, name }; }
function group(...members: Item[]): Item { return { flags: 2, members, name: "group" }; }

function mapItem<T>(item: Item, mapper: (item: Item) => T): T[] {
  if (!(item.flags & 2)) return [mapper(item)];
  const results: T[] = [];
  for (const member of item.members!) results.push(mapper(member));
  return results;
}
function mapItemLast<T>(item: Item, mapper: (item: Item) => T): T {
  if (!(item.flags & 2)) return mapper(item);
  let last: T | undefined;
  for (const member of item.members!) last = mapper(member);
  return last!;
}
function someItem(item: Item, test: (item: Item) => boolean): boolean {
  if (!(item.flags & 2)) return test(item);
  for (const member of item.members!) if (test(member)) return true;
  return false;
}

const three = group(leaf("a"), leaf("b"), leaf("c"));
const keptReaders: (() => string)[] = [];
const keptWriters: ((text: string) => void)[] = [];
const keptObjects: { count: number; label: string }[] = [];
const keptCallbacks: ((item: Item) => unknown)[] = [];

function readersOverTheScope(item: Item, prefix: string) {
  let calls = 0;
  return mapItem(item, member => { calls++; return () => prefix + member.name + calls; });
}
function readersKeptByTheCallback(item: Item, prefix: string) {
  let seen = "";
  mapItem(item, member => {
    seen += member.name;
    keptReaders.push(() => prefix + seen);
    keptWriters.push(text => { seen += text; });
    return 0;
  });
  return seen;
}
function capturedObjectIsStored(item: Item, label: string) {
  const tally = { count: 0, label };
  someItem(item, member => {
    tally.count += member.name.length;
    if (member.name === "b") keptObjects.push(tally);
    return false;
  });
  return tally.count;
}
function capturedObjectIsReturned(item: Item, label: string) {
  const tally = { count: 0, label };
  return mapItemLast(item, member => { tally.count += member.name.charCodeAt(0); return tally; });
}
function capturedCallbackIsReturned(item: Item, suffix: string) {
  const inner = (member: Item) => member.name + suffix;
  return mapItemLast(item, () => inner);
}
function capturedCallbackIsStored(item: Item, suffix: string) {
  let uses = 0;
  const inner = (member: Item) => member.name + suffix + ++uses;
  someItem(item, member => { if (member.name === "c") keptCallbacks.push(inner); return inner(member) === ""; });
  return uses;
}
function capturedObjectIsThrown(item: Item, label: string) {
  const problem = { count: 7, label };
  try {
    someItem(item, member => { if (member.name === "b") throw problem; problem.count++; return false; });
  } catch (thrown) {
    return thrown as { count: number; label: string };
  }
  return undefined;
}
function scopesOfIterations(item: Item) {
  const readers: (() => string)[] = [];
  for (let round = 0; round < 3; round++) {
    let text = "r" + round;
    mapItem(item, member => { text += member.name; readers.push(() => text + round); return 0; });
  }
  return readers;
}
function nothingOutlives(item: Item, wanted: string) {
  let steps = 0;
  const found = someItem(item, member => { steps++; return member.name === wanted; });
  return found + " " + steps;
}

// In tail position. The callee's own tail calls come to an end here.
function inTailPosition(item: Item, prefix: string) {
  let calls = 0;
  return mapItem(item, member => { calls++; return () => prefix + member.name + calls; });
}
function inTailPositionNothingOutlives(item: Item, wanted: string) {
  return someItem(item, member => member.name === wanted);
}
// And here they go round: no frame may stay behind, however many rounds there are.
function countDown(rounds: number, previous: () => number): number {
  if (rounds === 0) return previous();
  return countDown(rounds - 1, () => rounds);
}
function ping(rounds: number, total: { sum: number }, previous: () => number): number {
  if (rounds === 0) return total.sum + previous();
  total.sum += previous() & 1;
  return pong(rounds - 1, total, () => rounds);
}
function pong(rounds: number, total: { sum: number }, previous: () => number): number {
  if (rounds === 0) return total.sum - previous();
  return ping(rounds - 1, total, () => rounds + previous() % 3);
}

for (let round = 0; round < 3; round++) {
  const first = readersOverTheScope(three, "x" + round);
  const single = readersOverTheScope(leaf("z"), "y" + round);
  say("seen", readersKeptByTheCallback(three, "p" + round));
  say("count", capturedObjectIsStored(three, "t" + round));
  const returned = capturedObjectIsReturned(three, "u" + round);
  const inner = capturedCallbackIsReturned(three, "!" + round);
  say("uses", capturedCallbackIsStored(three, "?" + round));
  const thrown = capturedObjectIsThrown(three, "w" + round);
  const iterations = scopesOfIterations(three);
  say("nothing", nothingOutlives(three, "c"), nothingOutlives(three, "q"));
  const tail = inTailPosition(three, "t" + round);
  say("tail", inTailPositionNothingOutlives(three, "b"), inTailPositionNothingOutlives(leaf("b"), "a"));
  say("trample", trample(60, round, 2, 3));
  say("first", first.map(read => read()).join(","), single.map(read => read()).join(","));
  say("returned", returned.count, returned.label);
  say("inner", inner(leaf("i")));
  say("thrown", thrown && thrown.count, thrown && thrown.label);
  say("iterations", iterations.map(read => read()).join(","));
  say("tail readers", tail.map(read => read()).join(","));
}
for (const write of keptWriters) write("+");
say("trample", trample(80, 5, 6, 7));
say("readers", keptReaders.map(read => read()).join(","));
say("objects", keptObjects.map(object => object.label + object.count).join(","));
say("callbacks", keptCallbacks.map(callback => callback(leaf("k"))).join(","));
say("count down", countDown(300000, () => -1));
say("ping", ping(300001, { sum: 0 }, () => 1));
console.log(lines.join("\n"));
