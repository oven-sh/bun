// `new URLSearchParams(x)` that is only asked for its size, its text or a parameter, or walked by for..of, is compiled without allocating it. For any input the results and errors are those of plain Bun, also where the object escapes and where `URLSearchParams` is another class. Here nothing ever replaces the global, so the compiler knows the constructor.
// STATISTIC: URLsLeftUnbuilt >= 8
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

function sizeAndText(text: any) {
  const query = new URLSearchParams(text);
  return [query.size, query.size > 0 ? "?" : "", query.toString()];
}
function textOf(text: any) {
  return new URLSearchParams(text).toString();
}
function sizeOf(text: any) {
  return new URLSearchParams(text).size;
}
function parameterOf(text: any, name: any) {
  return new URLSearchParams(text).get(name);
}
function hasParameter(text: any, name: any) {
  return new URLSearchParams(text).has(name);
}
function threeParameters(text: any) {
  const query = new URLSearchParams(text);
  return [query.get("page"), query.get("limit"), query.get("sort"), query.has("a"), query.get(""), query.has("")];
}
function entriesOf(text: any) {
  const query = new URLSearchParams(text);
  const found: Record<string, unknown> = Object.create(null);
  for (const [key, value] of query.entries()) found[key] = key in found ? [found[key], value] : value;
  return Object.entries(found);
}
function walked(text: any) {
  const query = new URLSearchParams(text);
  const found: string[] = [];
  for (const [key, value] of query) found.push(key + "=" + value);
  return found;
}
function walkedAtOnce(text: any) {
  const found: unknown[] = [];
  for (const pair of new URLSearchParams(text)) found.push(pair);
  return found;
}
function keysAndValues(text: any) {
  const query = new URLSearchParams(text);
  const found: string[] = [];
  for (const key of query.keys()) found.push(key);
  for (const value of query.values()) found.push(value);
  return found;
}
function walkedTwiceAndAsked(text: any) {
  const query = new URLSearchParams(text);
  let count = 0;
  for (const pair of query) count += pair.length;
  for (const [key] of query.entries()) if (query.get(key) === null) count = -1;
  return [count, query.size, query.toString()];
}
function leftEarly(text: any) {
  const query = new URLSearchParams(text);
  for (const [key, value] of query) if (value !== "") return [key, value];
  return query.size;
}
function pairsAreFresh(text: any) {
  const query = new URLSearchParams(text);
  const kept: string[][] = [];
  for (const pair of query.entries()) {
    pair.push("more");
    kept.push(pair);
  }
  for (const pair of query.entries()) kept.push(pair);
  return kept;
}
function readInClosure(text: any) {
  const query = new URLSearchParams(text);
  const ask = () => query.size + query.toString();
  return ask() + ask();
}

let seed = 11;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x7fffffff);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const usual = ["a", "b", "page", "limit", "sort", "=", "=", "=", "&", "&", "1", "20", "top", "A", "Z", "0", "9", "*", "-", ".", "_", "a=1", "page=2&limit=10&sort=old"];
const odd = ["?", "+", "%", "%20", "%41", "%61", "%zz", "%C3%A9", "%c3%a9", "%ff", "&&", "==", " ", "~", "!", "'", "(", ")", ",", "/", ":", ";", "@", "$", "[", "]", "#", "é", "\u{1F600}", "\ud800", "\t", "\n", "\0", "\\", "\"", "<", "|"];
const texts: string[] = ["", "?", "??", "a", "a=", "=", "=1", "a=1", "?a=1", "??a=1", "a=1&", "&a=1", "a=1&&b=2", "a=1&b=2", "a=1&a=2&a=3", "a=b=c", "a&b", "page=2&limit=10&sort=top", "?page=2&limit=10&sort=top", "a=1&b", "a=+", "a=%20", "A-Z_a.z*0=9", "a=1#b", "__proto__=1&constructor=2&toString=3", "0=zero&1=one"];
for (let turn = 0; turn < 300; turn++) {
  let text = random() < 0.2 ? "?" : "";
  for (let n = Math.floor(random() * 9); n > 0; n--) text += random() < 0.9 ? pick(usual) : pick(odd);
  texts.push(text);
}
texts.push("k=" + "v".repeat(70000), Array.from({ length: 300 }, (_, i) => "k" + i + "=" + i).join("&"));
const brief = (value: unknown) => (JSON.stringify(value) ?? "undefined").length > 400 ? (JSON.stringify(value) as string).length : value;

const shapes = { sizeAndText, textOf, sizeOf, threeParameters, entriesOf, walked, walkedAtOnce, keysAndValues, walkedTwiceAndAsked, leftEarly, pairsAreFresh, readInClosure };
for (const text of texts) for (const [name, shape] of Object.entries(shapes)) say(name + " " + JSON.stringify(text.slice(0, 60)), () => brief(shape(text)));
for (const text of texts.slice(0, 60)) for (const name of ["a", "", "page", "A-Z_a.z*0", "+", "%61", "é", "__proto__", "0"]) say("parameter " + JSON.stringify(name) + " of " + JSON.stringify(text), () => [parameterOf(text, name), hasParameter(text, name)]);

const whole = "?prefix=0&page=2&limit=10";
say("a part of a string", () => [sizeAndText(whole.slice(1)), entriesOf(whole.slice(10)), threeParameters(whole.substring(1, 15)), walked(whole.slice(0, 9))]);
say("strings joined", () => { const left = "page=" + texts.length; return [sizeAndText(left + "&limit=" + seed), walked(left + "&a=b")]; });
say("sixteen bits a character", () => [sizeAndText("a=1&b=一".slice(0, 3)), walked("一a=1".slice(1))]);

function collected(text: string) {
  const query = new URLSearchParams(text);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of query) result[key] = result[key] === undefined ? value : [result[key], value];
  return Object.entries(result).map(([key, value]) => [key.length, key.slice(0, 5), value]);
}
for (let round = 0; round < 4; round++) {
  say("collected by name, round " + round, () => [collected("page=2&limit=10&sort=name"), collected("limit=1&page=" + round), collected("a=1&a=2&b=3&__proto__=4"), collected("x".repeat(63) + "=1&" + "x".repeat(64) + "=2&" + "x".repeat(65) + "=3&y=4&=5")]);
  if (round === 1) Bun.gc(true);
}

const order: string[] = [];
const spoken = (name: string, value: unknown) => ({ toString() { order.push(name); return value; } });
say("inputs that are no strings", () => [undefined, null, 5, true, {}, { a: 1, b: "two" }, [["a", "1"], ["b", "2"]], new Map([["m", "1"]]), new URLSearchParams("u=1"), new String("s=1"), spoken("input", "o=1")].map(input => [sizeAndText(input), walked(input), threeParameters(input)]));
say("inputs that are refused", () => sizeAndText([["a"]]));
say("a symbol", () => sizeOf(Symbol("s")));
say("names that are no strings", () => [parameterOf("1=one&null=n&undefined=u", 1), parameterOf("1=one&null=n&undefined=u", null), parameterOf("1=one&null=n&undefined=u", undefined), hasParameter("true=1", true), parameterOf("named=yes", spoken("name", "named")), order]);
say("a name that throws", () => parameterOf("a=1", { toString() { throw new RangeError("no name"); } }));
say("a name that is a symbol", () => parameterOf("a=1", Symbol("s")));

function escapes(text: string) {
  const query = new URLSearchParams(text);
  const kept = [query];
  return [query.size, kept[0] === query, kept[0] instanceof URLSearchParams, String(query)];
}
function isChanged(text: string) {
  const query = new URLSearchParams(text);
  query.append("more", "1");
  return [query.size, query.toString()];
}
function isChangedWhileWalked(text: string) {
  const query = new URLSearchParams(text);
  const found: string[] = [];
  for (const [key] of query) {
    found.push(key);
    if (found.length < 5) query.append(key + "x", "1");
  }
  return found;
}
function entriesKept(text: string) {
  const query = new URLSearchParams(text);
  const entries = query.entries();
  return [typeof entries.next, entries.next(), [...entries]];
}
function otherUses(text: string) {
  const query = new URLSearchParams(text);
  return [query.getAll("a"), [...query], Array.from(query.keys()), `${query}`, query + "", query.has("a", "1"), Object.fromEntries(query), JSON.stringify(query)];
}
function assignedTwice(text: string) {
  let query = new URLSearchParams(text);
  const first = query.size;
  query = new URLSearchParams("z=1&y=2&x=3");
  return [first, query.size];
}
function memberIsStored(text: string) {
  const query = new URLSearchParams(text) as any;
  query.size = 99;
  query.toString = () => "mine";
  return [query.size, query.toString()];
}
function methodIsHeld(text: string) {
  const query = new URLSearchParams(text);
  const held = query.get;
  return held.call(query, "a");
}
async function walkedAsynchronously(text: string) {
  const query = new URLSearchParams(text);
  const found: unknown[] = [];
  for await (const pair of query) found.push(pair);
  return found;
}
for (const text of ["a=1&b=2", "", "a=%20", "a"]) {
  for (const [name, shape] of Object.entries({ escapes, isChanged, isChangedWhileWalked, entriesKept, otherUses, assignedTwice, memberIsStored, methodIsHeld })) say(name + " " + JSON.stringify(text), () => shape(text));
}
lines.push("for await: " + JSON.stringify(await walkedAsynchronously("a=1&b=2")));

class Narrow extends URLSearchParams {
  get size() {
    return -1;
  }
  toString() {
    return "narrow " + super.toString();
  }
}
say("a subclass", () => { const query = new Narrow("a=1"); return [query.size, query.toString(), query.get("a")]; });
{
  class URLSearchParams {
    size = "local";
    constructor(public text: string) {}
    toString() {
      return "local " + this.text;
    }
    get(name: string) {
      return "local " + name;
    }
    *[Symbol.iterator]() {
      yield ["local", this.text];
    }
  }
  say("a local class of that name", () => { const query = new URLSearchParams("a=1"); const found: unknown[] = []; for (const pair of query) found.push(pair); return [query.size, query.toString(), query.get("a"), found]; });
}
console.log(lines.join("\n"));
