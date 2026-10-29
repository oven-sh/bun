type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
type Loose = { count: number; label: string; flag: boolean; extra: any; thing: object | null; note?: string };
type Outer = { first: Message; second: Inner | null; weight: number };
type Chain = { value: number; next: Chain | null };
type Left = { peer: Right | null; size: number };
type Right = { peer: Left | null; size: number };

const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const makeLoose = (count: number): Loose => ({ count, label: "made", flag: true, extra: 1, thing: null });
const makeOuter = (weight: number): Outer => ({ first: makeMessage(1, makeInner(2), []), second: null, weight });
const makeChain = (value: number): Chain => ({ value, next: null });
const makeLeft = (size: number): Left => ({ peer: null, size });
const makeRight = (size: number): Right => ({ peer: null, size });

let depth = 0;
function readMessage(message: Message): number {
  if (depth > 0) { depth--; return readMessage(message) + readMessage(message); }
  return message.id + message.inner.n + message.tags.length;
}
function readLoose(loose: Loose): string {
  if (depth > 0) { depth--; return readLoose(loose) + readLoose(loose); }
  return [loose.count, loose.label, loose.flag, typeof loose.extra, loose.thing === null ? "null" : typeof loose.thing, loose.note].join();
}
function readOuter(outer: Outer): number {
  if (depth > 0) { depth--; return readOuter(outer) + readOuter(outer); }
  return readMessage(outer.first) + (outer.second === null ? 0 : outer.second.n) + outer.weight;
}
function readChain(chain: Chain): number {
  let sum = 0;
  for (let at: Chain | null = chain, steps = 0; at !== null && steps < 5; at = at.next, steps++) sum += at.value;
  return sum;
}
function readLeft(left: Left): number {
  if (depth > 0) { depth--; return readLeft(left) + readLeft(left); }
  return left.size + (left.peer === null ? 0 : left.peer.size);
}
function readRight(right: Right): number {
  if (depth > 0) { depth--; return readRight(right) + readRight(right); }
  return right.size * 2 + (right.peer === null ? 0 : right.peer.size);
}

function readMessageInLoop(value: any, times = 1): number {
  let last: number = 0;
  for (let i = 0; i < times; i++) last = readMessage(value as Message);
  return last;
}
function readLooseInLoop(value: any, times = 1): string {
  let last: string = "";
  for (let i = 0; i < times; i++) last = readLoose(value as Loose);
  return last;
}
function readOuterInLoop(value: any, times = 1): number {
  let last: number = 0;
  for (let i = 0; i < times; i++) last = readOuter(value as Outer);
  return last;
}
function readChainInLoop(value: any, times = 1): number {
  let last: number = 0;
  for (let i = 0; i < times; i++) last = readChain(value as Chain);
  return last;
}
function readLeftInLoop(value: any, times = 1): number {
  let last: number = 0;
  for (let i = 0; i < times; i++) last = readLeft(value as Left);
  return last;
}
function readRightInLoop(value: any, times = 1): number {
  let last: number = 0;
  for (let i = 0; i < times; i++) last = readRight(value as Right);
  return last;
}
const plain = (...pairs: any[]): any => {
  const made = JSON.parse("{}");
  for (let i = 0; i < pairs.length; i += 2) made[pairs[i]] = pairs[i + 1];
  return made;
};
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
const describe = (value: any) => Object.keys(value).join() + " " + JSON.stringify(value);

console.log(readMessageInLoop(makeMessage(1, makeInner(2), ["a"])), readLooseInLoop(makeLoose(1)), readOuterInLoop(makeOuter(1)), readChainInLoop(makeChain(1)), readLeftInLoop(makeLeft(1)), readRightInLoop(makeRight(1)));

const typedInner = makeInner(7);
const tags = ["x", "y"];
const kept: any[] = [];
for (let turn = 0; turn < 4; turn++) {
  const inOrder = plain("id", turn, "inner", typedInner, "tags", tags);
  const otherOrder = plain("tags", tags, "id", turn + 0.5, "inner", typedInner);
  const parsed = JSON.parse(`{"id":${turn},"inner":null,"tags":["p"]}`);
  parsed.inner = typedInner;
  const withPlainChild = plain("id", turn, "inner", plain("n", turn), "tags", tags);
  const withMore = plain("id", turn, "inner", typedInner, "tags", tags, "more", "m");
  const wholly = JSON.parse(`{"id":${turn},"inner":{"n":${turn}},"tags":["a","b","c"]}`);
  for (const [label, message] of [["in order", inOrder], ["other order", otherOrder], ["parsed", parsed], ["plain child", withPlainChild], ["more keys", withMore], ["wholly parsed", wholly]] as [string, any][]) {
    kept.push(message);
    const child = message.inner;
    show(label, () => readMessageInLoop(message));
    show(label + " again", () => readMessageInLoop(message));
    show(label + " is itself", () => kept[kept.length - 1] === message && message.inner === child && describe(message));
    message.late = turn;
    message.id = -turn;
    show(label + " after stores", () => readMessageInLoop(message) + " " + describe(message));
    delete message.late;
    show(label + " after a delete", () => readMessageInLoop(message) + " " + describe(message));
  }
  for (const id of [0, -0, 1.5, NaN, Infinity, 2147483647, 2147483648, -2147483648, -1073741825, 1e300]) {
    const message = plain("id", id, "inner", typedInner, "tags", tags);
    show("id " + id, () => Object.is(message.id, id) && readMessageInLoop(message) + " " + Object.is(message.id, id));
  }
  const things: [string, any, any][] = [
    ["numbers", 1, null],
    ["plain objects", plain("a", 1), plain("b", 2)],
    ["typed objects", typedInner, makeMessage(1, typedInner, tags)],
    ["an array and a function", [1], () => 1],
    ["a date and a map", new Date(0), new Map()],
    ["an error and a promise", new Error("e"), Promise.resolve(1)],
    ["a string and a regular expression", "s", /r/],
    ["undefined and a symbol's wrapper", undefined, Object(Symbol.iterator)],
    ["a big integer and a typed array", 1n, new Uint8Array(1)],
  ];
  for (const [label, extra, thing] of things) {
    const loose = plain("count", turn, "label", "l", "flag", turn % 2 === 0, "extra", extra, "thing", thing);
    show(label, () => readLooseInLoop(loose) + " " + (loose.extra === extra) + " " + (loose.thing === thing) + " " + Object.keys(loose).join());
    const noted = plain("count", turn, "label", "l", "flag", false, "extra", extra, "thing", thing, "note", "n");
    show(label + " with a note", () => readLooseInLoop(noted) + " " + (noted.extra === extra) + " " + Object.keys(noted).join());
  }
  const outer = plain("first", plain("id", 1, "inner", plain("n", 2), "tags", ["t"]), "second", plain("n", 3), "weight", turn);
  show("three levels", () => readOuterInLoop(outer) + " " + describe(outer));
  show("three levels again", () => readOuterInLoop(outer));
  const halfTyped = plain("first", makeMessage(1, typedInner, tags), "second", null, "weight", turn);
  show("typed children", () => readOuterInLoop(halfTyped) + " " + describe(halfTyped));
  const spoiled = plain("first", plain("id", 1, "inner", plain("n", 2), "tags", ["t"]), "second", plain("n", 3), "weight", "heavy");
  show("good children of a wrong parent", () => readOuterInLoop(spoiled));
  show("and what is left of them", () => describe(spoiled) + " " + readMessageInLoop(spoiled.first));
  const chain = plain("value", 1, "next", plain("value", 2, "next", plain("value", 3, "next", plain("value", 4, "next", plain("value", 5, "next", plain("value", 6, "next", null))))));
  show("a chain", () => readChainInLoop(chain) + " " + describe(chain));
  const ring = plain("value", 1, "next", null);
  ring.next = ring;
  show("a ring", () => readChainInLoop(ring) + " " + (ring.next === ring));
  const longRing = plain("value", 1, "next", plain("value", 2, "next", null));
  longRing.next.next = longRing;
  show("a ring of two", () => readChainInLoop(longRing) + " " + (longRing.next.next === longRing));
  const pair = plain("peer", null, "size", 1);
  pair.peer = pair;
  show("its own peer, as the left", () => readLeftInLoop(pair) + " " + (pair.peer === pair));
  show("its own peer, as the right", () => readRightInLoop(pair) + " " + (pair.peer === pair));
  const one = plain("peer", null, "size", 1);
  const two = plain("peer", one, "size", 2);
  one.peer = two;
  show("two peers", () => readLeftInLoop(one) + " " + readRightInLoop(two) + " " + (one.peer === two) + " " + (two.peer === one));
  let asked = 0;
  const withGetter = plain("inner", typedInner, "tags", tags);
  Object.defineProperty(withGetter, "id", { get: () => { asked++; return 5; }, enumerable: true, configurable: true });
  show("a getter", () => readMessageInLoop(withGetter) + " " + asked);
  const readOnly = plain("id", 1, "inner", typedInner, "tags", tags);
  Object.defineProperty(readOnly, "id", { writable: false });
  show("a field that may not be written", () => readMessageInLoop(readOnly) + " " + Object.getOwnPropertyDescriptor(readOnly, "id")!.writable);
  const hidden = plain("id", 1, "inner", typedInner, "tags", tags);
  Object.defineProperty(hidden, "tags", { enumerable: false });
  show("a field that is not listed", () => readMessageInLoop(hidden) + " " + Object.keys(hidden).join());
  show("inherits", () => readMessageInLoop(Object.create(plain("id", 1, "inner", typedInner, "tags", tags))));
  show("frozen", () => readMessageInLoop(Object.freeze(plain("id", 1, "inner", typedInner, "tags", tags))));
  show("sealed", () => readMessageInLoop(Object.seal(plain("id", 1, "inner", typedInner, "tags", tags))));
  show("not extensible", () => readMessageInLoop(Object.preventExtensions(plain("id", 1, "inner", typedInner, "tags", tags))));
  show("another prototype", () => readMessageInLoop(Object.setPrototypeOf(plain("id", 1, "inner", typedInner, "tags", tags), plain("more", 1))));
  show("no prototype", () => readMessageInLoop(Object.assign(Object.create(null), plain("id", 1, "inner", typedInner, "tags", tags))));
  show("indexed too", () => readMessageInLoop(plain("id", 1, "inner", typedInner, "tags", tags, 0, "zero")));
  show("many keys", () => readMessageInLoop(plain("a", 1, "b", 2, "c", 3, "d", 4, "e", 5, "f", 6, "g", 7, "id", 1, "inner", typedInner, "tags", tags)));
  const shrunk = plain("gone", 1, "id", 1, "inner", typedInner, "tags", tags);
  delete shrunk.gone;
  show("after a delete", () => readMessageInLoop(shrunk) + " " + describe(shrunk));
  show("a string for the number", () => readMessageInLoop(plain("id", "1", "inner", typedInner, "tags", tags)));
  show("a number for the record", () => readMessageInLoop(plain("id", 1, "inner", 2, "tags", tags)));
  show("an object for the array", () => readMessageInLoop(plain("id", 1, "inner", typedInner, "tags", plain())));
  show("a wrong child", () => readMessageInLoop(plain("id", 1, "inner", plain("n", "n"), "tags", tags)));
  show("a missing key", () => readMessageInLoop(plain("id", 1, "inner", typedInner)));
  show("null", () => readMessageInLoop(plain("it", null).it));
  show("a number", () => readMessageInLoop(plain("it", 1).it));
  show("an array", () => readMessageInLoop(plain("it", [1]).it));
  if (turn === 1 && typeof Bun !== "undefined") Bun.gc(true);
  show("kept", () => kept.map(message => readMessageInLoop(message)).join());
}
