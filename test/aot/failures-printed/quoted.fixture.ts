// The message of a TypeError quotes the read or the call that failed. These functions are only ever called, so a compiled run has their text nowhere but in this file.
import { describe, it } from "../harness/declare";

const none = null as any;

function expand(value: string) {
  return value.replace(/x/g, "y");
}
function deep(value: { list: number[] }) {
  return value.list.length;
}
function two(first: { a: number }, second: { a: number }) {
  return first.a + second.a;
}
function marked(holder: { inner?: { name: string } }) {
  return holder.inner!.name;
}
// Not `return api.fetchUser(..)`: where a tail call fails, the report of a plain run leaves out the frame of the function that made it.
function call(api: any) {
  api.fetchUser("ARGUMENT", { token: 1 });
}
function markedCall(api: { run?: (text: string) => void }) {
  api.run!("ARGUMENT");
}
function twoCalls(api: any, other: any) {
  return [api.go("a"), other.go("b")];
}
function construct(space: any) {
  return new space.Missing("ARGUMENT");
}

function castCall(typed: {}) {
  (typed as any).other("ARGUMENT");
}
function castRead(typed: {}) {
  const read = (typed as any).inner.value;
  return read;
}
function castTwice(typed: {}) {
  // prettier-ignore
  ((typed as unknown) as any).other(1);
}
function castOfGeneric(typed: {}) {
  (typed as Record<string, (n: number) => void>).other(1);
}
function castInArgument(typed: any, x: {}) {
  typed.other((x as any).y, [x as any], { k: x as any });
}
function castConstruct(space: {}) {
  const made = new (space as any).Missing("ARGUMENT");
  return made;
}
function otherOnTheLine(typed: {}, x: any) {
  return [x.other(1), (typed as any).other(2)];
}
function either(a: any, b: any) {
  (a || b).other(1);
}
function marks(typed: any) {
  // prettier-ignore
  typed.other('single', `template`, "double");
}

function element(o: any, k: string) {
  const read = o.inner[k];
  return read;
}
function elementOfElement(o: any, k: string) {
  const read = o.list[0][k];
  return read;
}
function twoElements(a: any, b: any, k: string) {
  return [a[k], b[k]];
}
function computedKey(o: {}, k: string) {
  const read = (o as any).inner[k + "x"];
  return read;
}
function store(this: any, v: number) {
  this.state.count = v + 1;
}
function storeOfObject(o: any) {
  o.inner.x = { a: 1, b: [2] };
}
function storeOfElement(o: any, k: string) {
  o[k] = 1;
}
function storeInBrackets(o: any) {
  const stored = (o.x = 1);
  return stored;
}
function addTo(o: any) {
  o.x += 1;
}

function behindGlyphs(a: any, b: any) {
  return ["✓ │ é", "😀", a.x.y, b.x.y];
}
class Box {
  #held = 1;
  #method() {}
  static read(o: any) {
    const read = o.#held;
    return read;
  }
  static write(o: any) {
    o.#held = 2;
  }
  static call(o: any) {
    o.#method();
  }
}

function chainRead(config: any) {
  // prettier-ignore
  const value = config
    .get("a")
    .inner.value;
  return value;
}
function chainCall(builder: any) {
  // prettier-ignore
  builder
    .first()
    // it's a comment between
    .second("x")
    .third();
}
function callOverLines(api: any, one: number, two: string) {
  // prettier-ignore
  api.fetchUser(
    one,
    'two',
    two,
  );
}
function callOfObject(api: any) {
  api.fetchUser({
    name: "a name that is long enough to keep the object on several lines",
    more: [1, 2, "and a text that is long enough to do the same for this one"],
  });
}
function readBehindCallOverLines(api: any) {
  // prettier-ignore
  const value = api.get(
    "a",
    "b",
  ).inner.value;
  return value;
}
function constructOverLines(space: any) {
  // prettier-ignore
  const made = new space.Missing(
    "a",
    "b",
  );
  return made;
}
function storeOverLines(o: any, long: number) {
  // prettier-ignore
  o.inner.value =
    long + 1;
}
function castOverLines(config: any) {
  // prettier-ignore
  const value = (
    config.get("a") as any
  ).inner.value;
  return value;
}

function hasKey(value: any) {
  const found = "a" in value;
  return found;
}
function hasKeyOfPath(holder: { inner: any }, key: string) {
  const found = key in holder.inner;
  return [found, key];
}
function hasKeyBesideAnother(first: any, second: any) {
  return ["a" in first, "b" in second];
}
function hasKeyInCast(value: unknown) {
  const found = "a" in (value as object);
  return found;
}
function hasKeyBesideWalk(value: any, other: any) {
  for (const key in value) if (key in other) return key;
}
function remove(value: any) {
  delete value.a;
}
function removeElement(value: any, key: string) {
  delete value[key];
  return key;
}
function removeBesideAnother(first: any, second: any) {
  return [delete first.a, delete second.b];
}
function removeFromCast(value: unknown) {
  delete (value as any).a;
}
function readSymbol(value: any) {
  const method = value[Symbol.iterator];
  return method;
}
function storeSymbol(value: any) {
  value[Symbol.iterator] = 1;
}
function callElement(value: any, key: string) {
  value[key]("ARGUMENT");
  return key;
}
function callSymbol(value: any) {
  value[Symbol.iterator]();
}
class Made {
  speak() {
    return "made";
  }
}
function callOnConstructed() {
  (new Made() as any).missing("ARGUMENT");
}
function callBehindCallOnConstructed() {
  (new Made().speak() as any).missing();
}
function readOnConstructed() {
  const found = (new Made() as any).missing.deeper;
  return found;
}

describe("quoted as it is written", () => {
  it("a method of null", () => {
    expand(none);
  });
  it("a member two names deep", () => {
    deep({} as any);
  });
  it("the first of two reads on a line", () => {
    two(none, { a: 1 });
  });
  it("the second of two reads on a line", () => {
    two({ a: 1 }, none);
  });
  it("behind a mark that says it is there", () => {
    marked({});
  });
  it("a call with its arguments", () => {
    call({});
  });
  it("a call behind such a mark", () => {
    markedCall({});
  });
  it("the second of two calls on a line", () => {
    twoCalls({ go() {} }, {});
  });
  it("a construction with its arguments", () => {
    construct({});
  });
  it("a call behind a cast", () => {
    castCall({});
  });
  it("a member behind a cast", () => {
    castRead({});
  });
  it("two casts", () => {
    castTwice({});
  });
  it("a cast to a type with brackets of its own", () => {
    castOfGeneric({});
  });
  it("casts in the arguments", () => {
    castInArgument({}, {});
  });
  it("a construction behind a cast", () => {
    castConstruct({});
  });
  it("the call behind the cast and not the other of that name", () => {
    otherOnTheLine({}, { other() {} });
  });
  it("brackets that the meaning hangs on", () => {
    either(0, {});
  });
  it("texts in three kinds of quotes", () => {
    marks({});
  });
  it("an element", () => {
    element({}, "name");
  });
  it("an element of an element", () => {
    elementOfElement({ list: [] }, "name");
  });
  it("the second of two elements on a line", () => {
    twoElements({}, none, "name");
  });
  it("a key that is computed", () => {
    computedKey({}, "name");
  });
  it("a store with its value", () => {
    store.call({}, 1);
  });
  it("a store of an object", () => {
    storeOfObject({});
  });
  it("a store to an element", () => {
    storeOfElement(none, "name");
  });
  it("a store in brackets", () => {
    storeInBrackets(none);
  });
  it("a store that reads first", () => {
    addTo(none);
  });
  it("the second of two reads behind characters of several bytes", () => {
    behindGlyphs({ x: {} }, {});
  });
  it("a chain over lines", () => {
    chainRead({ get: () => ({}) });
  });
  it("a chain of calls over lines, with a comment between", () => {
    chainCall({ first: () => ({ second: () => ({}) }) });
  });
  it("arguments over lines", () => {
    callOverLines({}, 1, "2");
  });
  it("an object over lines", () => {
    callOfObject({});
  });
  it("a member behind arguments over lines", () => {
    readBehindCallOverLines({ get: () => ({}) });
  });
  it("a construction over lines", () => {
    constructOverLines({});
  });
  it("a store whose value stands in the next line", () => {
    storeOverLines({}, 1);
  });
  it("a cast over lines", () => {
    castOverLines({ get: () => ({}) });
  });
  it("a private name that the object lacks", () => {
    Box.read({});
  });
  it("a store to a private name that the object lacks", () => {
    Box.write({});
  });
  it("a private method that the object lacks", () => {
    Box.call({});
  });
  it("a key in null", () => {
    hasKey(none);
  });
  it("a key in a number", () => {
    hasKey(5);
  });
  it("a key in a path", () => {
    hasKeyOfPath({ inner: undefined }, "a");
  });
  it("the second of two keys", () => {
    hasKeyBesideAnother({}, none);
  });
  it("a key in a cast", () => {
    hasKeyInCast(none);
  });
  it("a key beside a walk over keys", () => {
    hasKeyBesideWalk({ a: 1 }, none);
  });
  it("a member deleted from null", () => {
    remove(none);
  });
  it("an element deleted from undefined", () => {
    removeElement(undefined, "a");
  });
  it("the second of two deletions", () => {
    removeBesideAnother({}, none);
  });
  it("a member deleted from a cast", () => {
    removeFromCast(none);
  });
  it("a symbol read from null", () => {
    readSymbol(none);
  });
  it("a symbol stored to null", () => {
    storeSymbol(none);
  });
  it("a call of an element", () => {
    callElement({}, "missing");
  });
  it("a call of a symbol", () => {
    callSymbol({});
  });
  it("a call on what was constructed", () => {
    callOnConstructed();
  });
  it("a call behind a call on what was constructed", () => {
    callBehindCallOnConstructed();
  });
  it("a read from what was constructed", () => {
    readOnConstructed();
  });
});
