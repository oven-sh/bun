// A captured let, const or class whose reader outlives the scope that left it unset or reaches it around the declaration: a closure of an earlier turn or an outer activation, a handler, a member of a class, a default of a pattern, the head of a loop.
function attempt(f) { try { return String(f()); } catch (e) { return e.name; } }
function fail() { throw new Error("failed"); }

function staleClosureCalledAfterLaterStore(turns) {
  let out = "";
  let previous = null;
  for (let turn = 0; turn < turns; turn++) {
    const read = () => inBody;
    if (turn === 0) { previous = read; continue; }
    let inBody = turn;
    inBody++;
    out += attempt(previous) + read() + ",";
  }
  return out;
}

function staleClosureHeldInCapturedBinding(turns) {
  let out = "";
  let previous = null;
  const callPrevious = () => previous();
  for (let turn = 0; turn < turns; turn++) {
    const read = () => inBody;
    if (turn === 0) { previous = read; continue; }
    let inBody = turn * 1.5;
    inBody++;
    out += attempt(callPrevious) + read() + ",";
  }
  return out;
}

function storedInSiblingBinding(callEarly) {
  let hook = null;
  function run() { return hook(); }
  hook = () => value;
  const early = callEarly ? attempt(run) : "skipped";
  let value = 41;
  value++;
  return early + " " + run();
}

function passedDown(depth, outerRead) {
  const read = () => mine;
  const early = outerRead ? attempt(outerRead) : "top";
  const below = depth > 0 ? passedDown(depth - 1, read) : "";
  let mine = depth;
  mine++;
  return early + "," + below + read();
}

function readInFinally(fails) {
  let read = () => "none";
  let out;
  try {
    read = () => value;
    let value = fails ? fail() : 43;
    value++;
  } catch {} finally { out = attempt(read); }
  return out;
}

function membersOfClassReadLate(callEarly) {
  class Holder {
    now = late;
    static peek() { return late; }
    get live() { return late; }
  }
  const early = callEarly ? attempt(() => new Holder().now) + attempt(Holder.peek) + attempt(() => Holder.prototype.live) : "skipped";
  let late = 45;
  late++;
  return early + " " + new Holder().now + Holder.peek() + new Holder().live;
}

function heritageReadsInnerName() {
  let seen;
  try { class Self extends (seen = attempt(() => Self), Object) {} } catch (e) { seen = "thrown " + e.name; }
  return seen;
}

function patternDefaults() {
  const readSecond = () => second;
  let { first = attempt(readSecond), second = 2.5 } = {};
  second++;
  return first + " " + readSecond();
}

function headOfForOf() {
  let out = "";
  for (const item of [attempt(() => item), 2]) out += item + ",";
  return out;
}

async function microtaskReadsEarly() {
  const read = () => value;
  const pending = Promise.resolve().then(() => attempt(read));
  const early = await pending;
  let value = 47;
  value++;
  return early + " " + read();
}

function headBindings() {
  let out = "";
  for (let read = () => later, early = attempt(read), later = 49; later < 51; later++) out += early + read() + ",";
  return out;
}

function privateStaticReadEarly() {
  class Private {
    static early = attempt(() => Private.#late);
    static #late = 51;
    static now() { return Private.#late; }
  }
  return Private.early + " " + Private.now();
}

class Base { constructor() { this.base = 13; } }
class Twice extends Base {
  constructor() {
    const callSuper = () => super();
    const self = () => this.base;
    const before = attempt(self);
    callSuper();
    this.text = before + " " + attempt(callSuper) + " " + self();
  }
}

function catchPattern() {
  let out;
  try { throw {}; } catch ({ first = attempt(() => second), second = 55 }) {
    const keep = () => second++;
    out = first + " " + keep() + keep();
  }
  return out;
}

function previousTurnIsInitialized(turns) {
  let out = "";
  let previous = null;
  for (let turn = 0; turn < turns; turn++) {
    if (previous) out += previous() + ",";
    let inBody = turn * 2;
    previous = () => inBody++;
  }
  return out;
}

function objectSlotAcrossCollection(size) {
  const read = () => held.list.length + held.text;
  const spare = (Bun.gc(true), new Array(size).fill(size));
  const held = (Bun.gc(true), { list: spare, text: "t" + size });
  Bun.gc(true);
  return read;
}

function valueOfCalledByInitializer() {
  const probe = { valueOf: () => (seen = attempt(() => total), 1) };
  let seen = "none";
  const total = probe + 1;
  return seen + " " + total + " " + attempt(() => total);
}

function* ownerThatYieldsItsReader() {
  const read = () => value;
  const answer = yield read;
  let value = 57;
  value++;
  yield answer + " " + read();
}

function throwsBetweenTwoDeclarations(fails) {
  let readBoth = () => "none";
  try {
    const first = 1.5;
    readBoth = () => first + second;
    const second = fails ? fail() : 2.5;
    return attempt(readBoth);
  } catch {
    return attempt(readBoth);
  }
}

console.log(staleClosureCalledAfterLaterStore(3), "|", staleClosureHeldInCapturedBinding(3));
console.log(storedInSiblingBinding(true), "|", storedInSiblingBinding(false), "|", passedDown(2, null));
console.log(readInFinally(true), readInFinally(false));
console.log(membersOfClassReadLate(true), "|", membersOfClassReadLate(false), "|", heritageReadsInnerName());
console.log(patternDefaults(), "|", headOfForOf(), "|", headBindings());
console.log(privateStaticReadEarly(), "|", new Twice().text, "|", catchPattern(), "|", previousTurnIsInitialized(4));
const readers = [objectSlotAcrossCollection(3), objectSlotAcrossCollection(4)];
Bun.gc(true);
console.log(readers[0](), readers[1](), valueOfCalledByInitializer());
const iterator = ownerThatYieldsItsReader();
console.log(iterator.next(attempt(iterator.next().value)).value);
console.log(throwsBetweenTwoDeclarations(true), throwsBetweenTwoDeclarations(false));
microtaskReadsEarly().then(text => console.log(text));
