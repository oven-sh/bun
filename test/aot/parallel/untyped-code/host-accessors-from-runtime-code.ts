// Evaluated text reads, 10,000 times at one site, what the interpreter's own cache cannot hold: accessors that the host implements natively (url, method, headers and signal of a Request, byteLength of a Buffer, size of a Blob), getters of classes, absent names and what a compiled object above the receiver has. Then what was read changes.
const lines: string[] = [];
const turns = 10_000;
function hide(value: unknown): any {
  return value;
}
const show = (value: unknown): string =>
  typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
function say(label: string, ...values: (string | number)[]) {
  lines.push(label + ": " + values.join(" | "));
}
function attempt(run: () => string | number): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}

type Site<Result> = (value: unknown, turns: number) => Result;
function sitesOf<Result>(body: (name: string) => string) {
  const sites = new Map<string, Site<Result>>();
  return (name: string): Site<Result> => {
    let site = sites.get(name);
    if (!site) sites.set(name, (site = new Function("value", "turns", body(name)) as Site<Result>));
    return site;
  };
}
const readerOf = sitesOf<unknown[]>(name => `const seen = []; for (let i = 0; i < turns; i++) { const v = value.${name}; if (!i || !Object.is(v, seen[seen.length - 1])) seen.push(v); } return seen;`);
const adderOf = sitesOf<number>(name => `let total = 0; for (let i = 0; i < turns; i++) total += value.${name}; return total;`);
const read = (name: string, value: unknown, times = turns) => attempt(() => readerOf(name)(value, times).map(show).join(" then "));
const add = (name: string, value: unknown, times = turns) => attempt(() => adderOf(name)(value, times));

type Handler = (request: unknown, buffer: unknown, blob: unknown, turns: number) => string;
const handler = new Function(
  "request",
  "buffer",
  "blob",
  "turns",
  `let total = 0;
  const headers = request.headers, signal = request.signal;
  for (let i = 0; i < turns; i++) {
    total += request.url.length + request.method.length + buffer.byteLength + blob.size;
    if (request.headers !== headers || request.signal !== signal) total += 1000000;
  }
  return [total, request.url, request.method, headers.get("x-name"), signal.aborted, buffer.byteLength, blob.size].join(" ");`,
) as Handler;
const handle = (request: unknown, buffer: unknown, blob: unknown) => attempt(() => handler(request, buffer, blob, turns));

const get = new Request("http://localhost/one", { headers: { "x-name": "get" } });
const post = new Request("http://localhost/two?x=1", { method: "POST", body: "text", headers: { "x-name": "post" } });
const aborted = new Request("http://localhost/aborted", { signal: AbortSignal.abort(), headers: { "x-name": "aborted" } });
const buffer = Buffer.from("some bytes"), longer = Buffer.alloc(300);
const blob = new Blob(["abc"]), larger = new Blob(["abcdef", "ghi"]);

function everyRequest(label: string) {
  say(label, handle(get, buffer, blob), handle(post, longer, larger), handle(aborted, buffer, larger), handle(get, longer, blob));
  say(label + ", one name at a site", read("url", get), read("url", post), read("method", get), read("method", post), read("headers", get), read("signal", get), read("signal.aborted", aborted), read("bodyUsed", post));
}
everyRequest("requests");

function tryToReplace(prototype: object, name: string) {
  const original = Object.getOwnPropertyDescriptor(prototype, name)!;
  try {
    Object.defineProperty(prototype, name, { get: () => "replaced", configurable: true });
  } catch {
    return;
  }
  Object.defineProperty(prototype, name, original);
}
for (const name of ["url", "method", "headers", "signal"]) tryToReplace(Request.prototype, name);
tryToReplace(Blob.prototype, "size");
everyRequest("after an attempt to replace the accessors");

class Heir extends Request {}
class Overriding extends Request {
  override get url() {
    return "overridden " + super.url;
  }
}
const heir = new Heir("http://localhost/heir", { headers: { "x-name": "heir" } });
const overriding = new Overriding("http://localhost/overriding", { method: "PUT", headers: { "x-name": "overriding" } });
say("a subclass", handle(heir, buffer, blob), read("url", heir), read("method", heir));
say("a subclass that overrides url", handle(overriding, buffer, blob), read("url", overriding), read("method", overriding));
everyRequest("requests after them");
Object.defineProperty(Heir.prototype, "url", {
  get(this: Request) {
    return "defined later for " + this.method;
  },
  configurable: true,
});
say("the subclass gets a getter", handle(heir, buffer, blob), read("url", heir), read("url", get));
delete hide(Heir.prototype).url;
say("and loses it", handle(heir, buffer, blob), read("url", heir));
Object.defineProperty(Heir.prototype, "method", { value: "A VALUE", configurable: true });
say("the subclass gets a value", handle(heir, buffer, blob), read("method", heir), read("method", get));
delete hide(Heir.prototype).method;
say("and loses it", handle(heir, buffer, blob), read("method", heir));

const changed = new Request("http://localhost/changed");
say("before an own property", read("url", changed));
Object.defineProperty(changed, "url", { value: "own", configurable: true });
say("an own property", read("url", changed), read("url", get));
delete hide(changed).url;
say("it is gone", read("url", changed));
hide(changed).extra = 1;
say("an own property of another name", read("url", changed), read("extra", changed), read("extra", get));
Object.setPrototypeOf(changed, { url: "of another chain" });
say("another chain", read("url", changed), read("method", changed));
Object.setPrototypeOf(changed, Request.prototype);
say("the first chain again", read("url", changed), read("method", changed));
say("what inherits from a request", read("url", Object.create(get)), read("method", Object.create(get)), read("headers", Object.create(get)));
say("the prototype itself", read("url", Request.prototype), read("method", Request.prototype));
say("a response where a request was", read("url", new Response("x")), read("method", new Response("x")), read("headers", new Response("x")));
say("no object", read("url", "text"), read("url", 5), read("url", undefined), read("url", null));

class Sized extends Blob {
  override get size() {
    return super.size + 1000;
  }
}
say("buffers", read("byteLength", buffer), read("byteLength", longer), read("length", buffer), read("byteLength", buffer.subarray(2, 5)), read("byteLength", new Uint8Array(7)), read("byteLength", new ArrayBuffer(9)), read("byteLength", new DataView(new ArrayBuffer(11))), read("byteLength", {}));
say("blobs", read("size", blob), read("size", larger), read("size", blob.slice(1)), read("size", new File(["abcd"], "name.txt")), read("size", new Sized(["ab"])), read("type", new Blob(["x"], { type: "text/plain" })), read("size", new Map([[1, 2]])), read("size", new Set([1, 2, 3])), read("size", {}));

const inTurn = new Function("values", "turns", "let total = 0; for (let i = 0; i < turns; i++) { let url; try { url = values[i % values.length].url; } catch (error) { url = error.constructor.name; } total += url === undefined ? 1 : url.length; } return total;") as Site<number>;
say("many receivers at one site", inTurn([get, post, heir, overriding, changed, { url: "plain" }, blob, Object.create(get), new Response("x"), [], aborted], turns));

let calls = 0;
class Compiled {
  get one() {
    calls++;
    return 1;
  }
  get self() {
    return this;
  }
}
const Ordinary = new Function("count", "return class Ordinary { get one() { count(); return 1; } get self() { return this; } };")(() => {
  calls++;
}) as new () => object;
const countSelf = new Function("value", "turns", "let same = 0; for (let i = 0; i < turns; i++) if (value.self === value) same++; return same;") as Site<number>;
const classes: [string, new () => object][] = [
  ["a compiled class", Compiled],
  ["a class of the text", Ordinary],
];
for (const [kind, Class] of classes) {
  const instance = new Class(), below = Object.create(instance);
  calls = 0;
  say("a getter of " + kind, add("one", instance), calls, add("one", below), calls, add("one", new Class()), calls);
  say("its receiver", countSelf(instance, turns), countSelf(below, turns));
  Object.defineProperty(Class.prototype, "one", {
    get() {
      calls += 2;
      return 2;
    },
    configurable: true,
  });
  calls = 0;
  say("another getter", add("one", instance), calls, add("one", below), calls);
  Object.defineProperty(Class.prototype, "one", { value: 3, writable: true, configurable: true });
  calls = 0;
  say("a value", add("one", instance), add("one", below), calls);
  delete hide(Class.prototype).one;
  say("nothing", add("one", instance), add("one", below), read("one", instance));
  Object.defineProperty(instance, "one", { get: () => 4, configurable: true });
  say("a getter of its own", add("one", instance), add("one", below), add("one", new Class()));
  delete hide(instance).one;
  hide(Class.prototype).one = 5;
  say("a value again", add("one", instance), add("one", below));
}

let left = 0;
class Throwing {
  get risky() {
    if (!left--) throw new RangeError("enough");
    return 1;
  }
}
const ThrowingInText = new Function("check", "return class { get risky() { check(); return 1; } };")(() => {
  if (!left--) throw new RangeError("enough");
}) as new () => object;
const untilThrown = new Function("value", "turns", "let i = 0; try { for (; i < turns; i++) value.risky; } catch (error) { return i + ' ' + error.message; } return i + ' none';") as Site<string>;
for (const Class of [Throwing, ThrowingInText] as (new () => object)[]) {
  const instance = new Class();
  left = 5000;
  const first = untilThrown(instance, turns);
  left = 20_000;
  const second = untilThrown(instance, turns);
  left = 0;
  say("a getter that throws", first, second, untilThrown(instance, turns), add("risky", instance));
}

const parsed = JSON.parse('{"a":1,"b":"two"}');
const root: Record<string, unknown> = {};
const child = Object.create(root);
const closure = () => 1;
const list = [1, 2];
const ofCompiled = new Compiled(), ofOrdinary = new Ordinary();
const everyMissing = (label: string) =>
  say(label, ...[parsed, child, get, heir, list, buffer, blob, closure, ofCompiled, ofOrdinary].map(value => read("missing", value)));
everyMissing("an absent name");
root.missing = "of the root";
parsed.missing = "own";
hide(get).missing = "own";
hide(Heir.prototype).missing = "of the subclass";
hide(list).missing = "own";
hide(buffer).missing = "own";
hide(blob).missing = "own";
hide(closure).missing = "own";
hide(Compiled.prototype).missing = "of the class";
hide(Ordinary.prototype).missing = "of the class";
everyMissing("the name is there");
for (const holder of [root, parsed, get, Heir.prototype, list, buffer, blob, closure, Compiled.prototype, Ordinary.prototype]) delete hide(holder).missing;
everyMissing("the name is absent again");
for (const holder of [root, Heir.prototype, Compiled.prototype, Ordinary.prototype]) Object.defineProperty(holder, "missing", { get: () => "got", configurable: true });
everyMissing("a getter above");
for (const holder of [root, Heir.prototype, Compiled.prototype, Ordinary.prototype]) delete hide(holder).missing;
everyMissing("absent once more");

class Item {
  whole = 1;
  text = "text";
  maybe?: number;
  method() {
    return "method";
  }
  get computed() {
    return "computed " + this.whole;
  }
}
const item = new Item(), below = Object.create(item), belowPrototype = Object.create(Item.prototype);
const everyMember = (label: string) =>
  say(label, ...["whole", "text", "maybe", "method", "computed", "extra", "missing"].map(name => read(name, below)), read("whole", belowPrototype), read("method", belowPrototype), read("computed", belowPrototype));
everyMember("a compiled object above");
item.whole = 2;
item.text = "changed";
item.maybe = 3;
everyMember("its fields change");
hide(item).extra = "extra";
everyMember("it gets another property");
delete hide(item).whole;
delete item.maybe;
delete hide(item).extra;
everyMember("it loses properties");
hide(item).whole = "a string";
hide(Item.prototype).maybe = "of the class";
everyMember("a value of another type, and a name above");
delete hide(Item.prototype).maybe;
hide(below).whole = "own";
everyMember("an own property in front");
delete hide(below).whole;
Object.setPrototypeOf(below, new Item());
everyMember("another compiled object above");
Object.setPrototypeOf(below, null);
everyMember("nothing above");

const lengthAtFirstSite = new Function("value", "turns", "let total = 0; for (let i = 0; i < turns; i++) total += value.length; return total;") as Site<number>;
const lengthAtSecondSite = new Function("value", "turns", "let total = 0; for (let i = 0; i < turns; i++) total += value.length; return total;") as Site<number>;
const lengthByPattern = new Function("value", "turns", "let total = 0; for (let i = 0; i < turns; i++) { const { length } = value; total += length; } return total;") as Site<number>;
const arrays: unknown[] = [[1, 2, 3], [], [1.5], ["a", "b"], new Array(5), [1, , 3, 4]];
say("the length of arrays at one site", ...arrays.map(array => lengthAtFirstSite(array, turns)));
say("at a second site", ...arrays.map(array => lengthAtSecondSite(array, turns)));
say("in a pattern", ...arrays.map(array => lengthByPattern(array, turns)));
const grown = [1, 2, 3];
say("an array grows", lengthAtFirstSite(grown, turns), (grown.push(4), lengthAtSecondSite(grown, turns)), ((grown.length = 1), lengthAtFirstSite(grown, turns)), lengthByPattern(grown, turns));
say("what is no array", ...["text", { length: 7 }, buffer, closure, new Uint8Array(2)].map(value => [lengthAtFirstSite(value, turns), lengthAtSecondSite(value, turns), lengthByPattern(value, turns)].join()));

const countAbsent = new Function("value", "turns", "let absent = 0; for (let i = 0; i < turns; i++) if (value.seldom === undefined) absent++; return absent;") as Site<number>;
let total = 0;
for (let round = 0; round < 300; round++) {
  const parent: Record<string, unknown> = { ["own" + round]: round };
  const heirOfParent = Object.create(parent);
  total += countAbsent(heirOfParent, 20);
  parent.seldom = round;
  total += countAbsent(heirOfParent, 20) * 1000;
  delete parent.seldom;
  total += countAbsent(heirOfParent, 20);
  const request = new Request("http://localhost/" + round);
  hide(request)["own" + round] = round;
  total += Number(add("url.length", request, 20));
  if (round % 100 === 99) Bun.gc(true);
}
say("shapes that die", total);
everyRequest("requests at the end");
console.log(lines.join("\n"));
