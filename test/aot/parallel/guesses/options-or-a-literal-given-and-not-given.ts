// `options || {}` and its kin: the literal is written for the absent case; every form is asked with options given (a literal, a copy made by a loop, a parsed object, an instance, one with an accessor) and not given
type Bag = any;
function byOr(options?: Bag) {
  var opts = options || {};
  return [opts.limit, opts.length, opts.encoding, "verify" in opts].join();
}
function byNullish(options?: Bag) {
  const opts = options ?? {};
  return [opts.limit, opts.length, opts.encoding].join();
}
function byDefault(opts: Bag = {}) {
  return [opts.limit, opts.length, opts.encoding].join();
}
function withAnsweringLiteral(options?: Bag) {
  const opts = options || { limit: 1 };
  return [opts.limit, opts.length].join();
}
function withLiteralThatAnswersNothingAsked(options?: Bag) {
  const opts = options || { limit: 1 };
  return [opts.length, opts.encoding].join();
}
function withList(list?: Bag) {
  const items = list || [];
  return items.length;
}
function storesOnIt(options?: Bag) {
  const opts = options || {};
  opts.seen = (opts.seen | 0) + 1;
  return [opts.seen, opts.limit].join();
}
function byTernary(options?: Bag) {
  const opts = options !== undefined ? options : {};
  return [opts.limit, opts.toString === Object.prototype.toString, opts.hasOwnProperty("limit")].join();
}
class Entry {
  hits = 0;
  constructor(public key: string) {}
}
const cache: Record<string, Entry> = Object.create(null);
function cached(key: string) {
  const entry = cache[key] || (cache[key] = new Entry(key));
  entry.hits++;
  return entry.key + entry.hits;
}
function inLoop(all: Bag[]) {
  let said = "";
  for (let i = 0; i < all.length; i++) {
    const opts = all[i] || {};
    said += [opts.limit, opts.length].join() + ";";
  }
  return said;
}
class Options {
  limit = 5;
  get length() { return 6; }
}
function copyOf(from: Bag) {
  const made: Bag = {};
  for (const key in from) made[key] = from[key];
  return made;
}
const given: [string, () => Bag][] = [
  ["nothing", () => undefined],
  ["null", () => null],
  ["a literal", () => ({ limit: 3, length: 4, encoding: "utf8" })],
  ["a literal of other names", () => ({ other: 1 })],
  ["an empty literal", () => ({})],
  ["a copy by a loop", () => copyOf({ limit: 7, length: 8 })],
  ["a parsed object", () => JSON.parse('{"limit":9,"encoding":"hex"}')],
  ["an instance with an accessor", () => new Options()],
  ["an object without a prototype", () => Object.assign(Object.create(null), { limit: 10 })],
  ["a frozen literal", () => Object.freeze({ limit: 11, seen: 2 })],
  ["a function", () => Object.assign(function two(a: Bag, b: Bag) {}, { limit: 12 })],
  ["a text", () => "text"],
  ["a number", () => 13],
  ["zero", () => 0],
  ["a list", () => [1, 2, 3]],
];
const forms: [string, (options?: Bag) => unknown][] = [
  ["||", byOr], ["??", byNullish], ["a default", byDefault], ["|| { limit: 1 }", withAnsweringLiteral], ["|| { limit: 1 }, other names asked", withLiteralThatAnswersNothingAsked],
  ["|| []", withList], ["stores on it", storesOnIt], ["a ternary", byTernary],
];
const log: string[] = [];
for (const [form, ask] of forms) {
  for (const [what, make] of given) {
    let said = "";
    for (let turn = 0; turn < 12; turn++) {
      let now: string;
      try {
        now = String(ask(make()));
      } catch (error) {
        now = "threw " + (error as Error).constructor.name;
      }
      if (!said.endsWith(now)) said += (said ? " THEN " : "") + now;
    }
    log.push(form + " . " + what + ": " + said);
  }
}
log.push("the cache: " + [cached("a"), cached("b"), cached("a"), cached("a"), cached("b")].join());
log.push("in a loop: " + inLoop(given.map(([, make]) => make())));
console.log(log.join("\n"));
