// A literal that is written under `Record<string, T>` or an index signature has the names that are written, and the type allows any other. Some of these are only read, some grow, some lose names,
// some are handed to code that nobody knows, and one site makes objects of both sorts. Each line must read as it does without a compiler.
type Numbers = Record<string, number>;
interface ByName {
  [name: string]: number;
}

const lines: string[] = [];
function say(label: string, ...values: unknown[]) {
  lines.push(label + ": " + values.map(value => (typeof value === "string" ? value : JSON.stringify(value))).join(" | "));
}
function key(text: string): string {
  return text.split("").reverse().reverse().join("");
}
function namesByForIn(object: object): string {
  let names = "";
  for (const name in object) names += name + ",";
  return names;
}

// Only read.
const read: Numbers = { alpha: 1, bravo: 2, charlie: 3 };
say("read by name", read.alpha, read.bravo, read.charlie, read.delta);
say("read by key", read[key("alpha")], read[key("charlie")], read[key("delta")], read[key("toString")] === (Object.prototype.toString as unknown));
say("read has", "alpha" in read, key("bravo") in read, "delta" in read, Object.hasOwn(read, key("charlie")), read.hasOwnProperty("delta"), "constructor" in read);
say("read listed", Object.keys(read), Object.values(read), Object.entries(read), namesByForIn(read), read);
say("read copied", { ...read }, Object.assign({}, read), { ...read, bravo: 20, echo: 5 });

// Grows under keys that only the run knows, also under names that it has.
const grown: Numbers = { alpha: 1, bravo: 2 };
for (const name of ["zulu", "2", "alpha", "1", "yankee"]) grown[key(name)] = name.length;
say("grown", grown, Object.keys(grown), namesByForIn(grown), grown.alpha, grown.zulu, grown[1], grown["2"]);

// Loses names, by key and by name, and gets them back: they come last.
const shrunk: ByName = { alpha: 1, bravo: 2, charlie: 3 };
say("deleted", delete shrunk[key("alpha")], delete shrunk.charlie, delete shrunk[key("nothing")], shrunk, "alpha" in shrunk, shrunk.alpha);
shrunk.alpha = 10;
shrunk[key("charlie")] = 30;
say("put back", shrunk, Object.keys(shrunk));

// One site, many objects: every other one grows.
function make(i: number): Numbers {
  return { first: i, second: i * 2 };
}
let sum = 0;
const made: Numbers[] = [];
for (let i = 0; i < 2000; i++) {
  const one = make(i);
  if (i & 1) one[key("third") + (i % 3)] = i;
  sum += one.first + one.second + (one.third0 ?? 0) + (one[key("third1")] ?? 0);
  if (i % 500 === 1) made.push(one);
}
say("one site", sum, made);

// One site whose objects are only read, in a loop.
function pair(i: number): Numbers {
  return { low: i, high: i + 1 };
}
let total = 0;
for (let i = 0; i < 5000; i++) {
  const one = pair(i);
  total += one.low * one.high;
}
say("pairs", total);

// Names that built-in objects have, an empty name, names that look like numbers, and an own property named __proto__.
const __proto__ = 7;
const odd: Numbers = { constructor: 1, toString: 2, "": 3, "01": 4, "1": 5, "0": 6, "-1": 8, "1.5": 9, __proto__ };
say("odd names", Object.keys(odd), odd.constructor, odd[key("toString")], odd[""], odd["01"], odd[1], odd[0], odd["-1"], odd[1.5], Object.hasOwn(odd, "__proto__"), Object.getPrototypeOf(odd) === Object.prototype);
const below: Record<string, unknown> = { __proto__: read, own: 1 };
say("below another", below.alpha, below.own, Object.keys(below), namesByForIn(below), Object.getPrototypeOf(below) === read);

// Changed through built-ins.
const defined: Numbers = { alpha: 1, bravo: 2 };
Object.defineProperty(defined, "alpha", { get: () => 100, enumerable: false, configurable: true });
Object.defineProperty(defined, key("hidden"), { value: 5, enumerable: false });
say("defined", defined.alpha, defined[key("alpha")], defined.hidden, Object.keys(defined), defined, Object.getOwnPropertyNames(defined));
const frozen: Numbers = Object.freeze({ alpha: 1, bravo: 2 } as Numbers);
let refused = "";
try {
  frozen[key("charlie")] = 3;
} catch (error) {
  refused += (error as Error).constructor.name;
}
try {
  frozen.alpha = 3;
} catch (error) {
  refused += " " + (error as Error).constructor.name;
}
try {
  delete frozen[key("bravo")];
} catch (error) {
  refused += " " + (error as Error).constructor.name;
}
say("frozen", refused, frozen, Object.isFrozen(frozen));
const linked: Numbers = { alpha: 1 };
Object.setPrototypeOf(linked, { inherited: 9 });
say("linked", linked.inherited, linked[key("inherited")], Object.keys(linked), namesByForIn(linked));
const assigned: Numbers = { alpha: 1, bravo: 2 };
Object.assign(assigned, JSON.parse('{"bravo":20,"charlie":30}'));
say("assigned", assigned, assigned.bravo, assigned.charlie);

// Handed to code that nobody knows.
const handed: Numbers = { alpha: 1, bravo: 2 };
(globalThis as Record<string, unknown>)[key("holder")] = handed;
new Function("holder.charlie = 3; delete holder.alpha; holder.bravo = 'text'")();
say("handed out", handed, handed.alpha, handed.bravo, handed.charlie, typeof handed.bravo);

// Methods, which see the object they are called on.
const methods: Record<string, (this: Record<string, unknown>, by: number) => number> = {
  twice(by) {
    return by * 2 + Object.keys(this).length;
  },
  thrice: function (by) {
    return by * 3 + Object.keys(this).length;
  },
};
say("methods", methods.twice(1), methods[key("thrice")](1), methods.twice.name, methods.thrice.name);

// In other literals, under an assertion, under `satisfies`, as an argument, as a default, and as what a function returns.
const nested: { byName: Numbers; list: Numbers[] } = { byName: { alpha: 1 }, list: [{ alpha: 1 }, {}, { bravo: 2 }] };
nested.byName[key("bravo")] = 2;
nested.list[1][key("charlie")] = 3;
say("nested", nested, nested.byName.alpha, nested.list[0].alpha, nested.list[1].charlie, nested.list[2].alpha);
const asserted = { alpha: 1 } as Numbers;
asserted[key("bravo")] = 2;
const satisfied = { alpha: 1, bravo: 2 } satisfies Numbers;
function count(numbers: Numbers = { none: 0 }): number {
  let counted = 0;
  for (const name in numbers) counted += numbers[name] + name.length;
  return counted;
}
say("places", asserted, satisfied.alpha + satisfied.bravo, count({ alpha: 1, bravo: 2 }), count(), count(grown));

// It has the names of a type with members, and is tested for where that type is asked for.
interface Point {
  x: number;
  y: number;
}
function isPoint(value: unknown): value is Point {
  return typeof value === "object" && value !== null && "x" in value && "y" in value;
}
const likePoint: Numbers = { x: 1, y: 2 };
likePoint[key("z")] = 3;
const points: unknown[] = [likePoint, { x: 3, y: 4 } as Point, { x: 5 }];
say("like a point", points.filter(isPoint).map(point => point.x + point.y), likePoint);

// Values of other types than the type says.
const loose: Numbers = { alpha: JSON.parse('"text"'), bravo: JSON.parse("null"), charlie: 1 };
say("loose", loose, typeof loose.alpha, loose.bravo, loose.charlie + 1);

// A table of constants that is read by words from outside.
const codes: Record<string, string> = { ok: "200", created: "201", missing: "404", broken: "500" };
let answered = "";
for (const word of "ok missing nothing broken created toString".split(" ")) answered += (Object.hasOwn(codes, word) ? codes[word] : "-") + " ";
say("table", answered);

console.log(lines.join("\n"));
