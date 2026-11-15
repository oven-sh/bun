// One object in each of the states in which it may come, times each question that narrows its class, times each use.
//
//   bun write-kind-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<question>--<use>--<place>--<the odd one>--<how it comes>.mjs
//   bun write-kind-sweep.ts count
//   bun write-kind-sweep.ts named <pattern> <folder> [most]
//
// `o instanceof Kind` says what lies above an object. It does not say which fields the object has, where they lie, what they hold, or whether a method of its own hides the one of the class.
// A program holds one question, one use and one place, and one function that an instance, an heir and an object of another class go through. Then one odd object goes through it: an instance that lost or gained
// a field, one that was moved below another class, a record that looks alike, a proxy, what is no object at all. Each prints what the use answered and what the object looks like afterwards. `bun <file>` is
// what it is held against.
import { mkdirSync, writeFileSync } from "node:fs";

const objects: [name: string, made: string][] = [
  ["an-instance", "new Kind()"],
  ["an-heir", "new Heir()"],
  ["an-heir-of-the-heir", "new Last()"],
  ["of-another-class", "new Other()"],
  ["of-a-constructor-function", "new Old()"],
  ["of-a-class-below-a-constructor-function", "new Young()"],
  ["a-record-alike", '{ a: 1, b: 2.5, tag: "kind", sum() { return 0; }, twice: 5 }'],
  ["a-record-with-the-fields-the-other-way-round", '{ tag: "kind", b: 2.5, a: 1 }'],
  ["a-parsed-record", `JSON.parse('{"a":1,"b":2.5,"tag":"kind"}')`],
  ["made-below-the-prototype", "Object.create(Kind.prototype)"],
  ["made-below-nothing", 'Object.assign(Object.create(null), { a: 1, b: 2.5, tag: "kind" })'],
  ["an-instance-moved-below-another-class", "Object.setPrototypeOf(new Kind(), Other.prototype)"],
  ["of-another-class-moved-below-it", "Object.setPrototypeOf(new Other(), Kind.prototype)"],
  ["an-instance-with-a-field-more", "Object.assign(new Kind(), { extra: 9 })"],
  ["an-instance-with-a-field-less", "without(new Kind())"],
  ["an-instance-whose-field-was-deleted-and-set-again", "again(new Kind())"],
  ["an-instance-whose-field-is-a-getter", "gotten(new Kind())"],
  ["an-instance-whose-field-is-read-only", 'Object.defineProperty(new Kind(), "a", { value: 41, writable: false, enumerable: true, configurable: true })'],
  ["an-instance-whose-field-holds-a-text", 'Object.assign(new Kind(), { a: "text" })'],
  ["an-instance-whose-field-holds-a-fraction", "Object.assign(new Kind(), { a: 0.5 })"],
  ["an-instance-whose-field-holds-nothing", "Object.assign(new Kind(), { a: undefined })"],
  ["an-instance-with-a-method-of-its-own", "Object.assign(new Kind(), { sum: () => 77 })"],
  ["a-frozen-instance", "Object.freeze(new Kind())"],
  ["a-sealed-instance", "Object.seal(new Kind())"],
  ["an-instance-that-takes-no-more", "Object.preventExtensions(new Kind())"],
  ["a-proxy-of-an-instance", "new Proxy(new Kind(), {})"],
  ["an-instance-of-a-class-made-in-a-function", "new (makeKind())()"],
  ["a-clone-of-an-instance", "structuredClone(new Kind())"],
  ["a-spread-of-an-instance", "{ ...new Kind() }"],
  ["a-list", "[1, 2.5]"],
  ["a-function", "function named() {}"],
  ["the-class-itself", "Kind"],
  ["its-prototype", "Kind.prototype"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["a-number", "7"],
  ["a-text", '"text"'],
]; // prettier-ignore

const questions: [name: string, open: string, close: string][] = [
  ["nothing-asked", "{", "}"],
  ["is-of-the-class", "if (o instanceof Kind) {", "}"],
  ["is-not-of-the-class", "if (!(o instanceof Kind)) {", "}"],
  ["leaves-where-it-is-not-of-the-class", 'if (!(o instanceof Kind)) return "left"; {', "}"],
  ["is-of-the-heir", "if (o instanceof Heir) {", "}"],
  ["is-of-the-class-and-not-of-the-heir", "if (o instanceof Kind && !(o instanceof Heir)) {", "}"],
  ["is-of-another-class", "if (o instanceof Other) {", "}"],
  ["is-of-the-constructor-function", "if (o instanceof Old) {", "}"],
  ["is-of-either", "if (o instanceof Kind || o instanceof Other) {", "}"],
  ["is-an-object-by-its-class", "if (o instanceof Object) {", "}"],
  ["is-what-a-class-says-it-is", "if (o instanceof Asked) {", "}"],
  ["was-constructed-by-the-class", "if (o.constructor === Kind) {", "}"],
  ["lies-right-below-the-prototype", "if (Object.getPrototypeOf(o) === Kind.prototype) {", "}"],
  ["lies-below-the-prototype", "if (Kind.prototype.isPrototypeOf(o)) {", "}"],
  ["has-the-private-name", "if (Kind.is(o)) {", "}"],
  ["has-the-tag", 'if (o.tag === "kind") {', "}"],
  ["a-case-of-the-tag", 'switch (o.tag) { case "other": return "other"; case "kind": {', "} }"],
  ["has-the-field", 'if ("a" in o) {', "}"],
  ["has-the-field-itself", 'if (Object.hasOwn(o, "a")) {', "}"],
  ["its-field-is-a-number", 'if (typeof o.a === "number") {', "}"],
  ["its-field-is-something", "if (o?.a !== undefined) {", "}"],
  ["has-the-method-of-the-class", "if (o.sum === Kind.prototype.sum) {", "}"],
  ["is-an-object", 'if (typeof o === "object" && o !== null) {', "}"],
  ["is-something", "if (o != null) {", "}"],
  ["holds", "if (o) {", "}"],
  ["is-a-list", "if (Array.isArray(o)) {", "}"],
  ["is-no-list", "if (!Array.isArray(o)) {", "}"],
  ["is-a-function", 'if (typeof o === "function") {', "}"],
];

const uses: [name: string, block: string][] = [
  ["reads-the-whole-number", "return tell(o.a);"],
  ["reads-the-fraction", "return tell(o.b);"],
  ["reads-the-text", "return tell(o.tag);"],
  ["adds-two-fields", "return tell(o.a + o.b);"],
  ["reads-a-field-of-the-heir", "return tell(o.c);"],
  ["reads-a-field-that-no-class-has", "return tell(o.missing);"],
  ["reads-under-a-key-nobody-knows", "return tell(o[key]);"],
  ["reads-the-getter", "return tell(o.twice);"],
  ["calls-the-method", "return tell(o.sum());"],
  ["calls-the-method-if-it-is-there", "return tell(o.sum?.());"],
  ["calls-the-method-of-the-class-on-it", "return tell(Kind.prototype.sum.call(o));"],
  ["calls-what-reads-the-private-name", "return tell(o.own());"],
  ["reads-the-private-name-by-the-class", "return tell(Kind.ownOf(o));"],
  ["stores-a-whole-number", "o.a = 5; return tell(o.a);"],
  ["stores-a-fraction-over-the-whole-number", "o.a = 0.25; return tell(o.a);"],
  ["stores-a-text-over-the-whole-number", 'o.a = "stored"; return tell(o.a);'],
  ["stores-nothing-over-the-whole-number", "o.a = undefined; return tell(o.a);"],
  ["stores-a-whole-number-over-the-fraction", "o.b = 4; return tell(o.b);"],
  ["stores-what-nobody-knows", "o.a = unknown; return tell(o.a);"],
  ["stores-under-a-key-nobody-knows", "o[key] = 6; return tell(o.a);"],
  ["raises-the-whole-number", "o.a++; return tell(o.a);"],
  ["doubles-the-fraction", "o.b *= 2; return tell(o.b);"],
  ["adds-a-field", "o.added = 1; return tell(o.added);"],
  ["deletes-a-field", "return tell(delete o.a) + tell(o.a);"],
  ["deletes-a-field-and-sets-it-again", "delete o.a; o.a = 8; return tell(o.a) + Object.keys(o).join();"],
  ["stores-a-method-of-its-own", "o.sum = () => 55; return tell(o.sum());"],
  ["redefines-a-field-as-a-getter", 'Object.defineProperty(o, "a", { get: () => 31, configurable: true, enumerable: true }); return tell(o.a);'],
  ["moves-it-below-another-class", "Object.setPrototypeOf(o, Other.prototype); return tell(o.sum()) + tell(o instanceof Kind);"],
  ["freezes-it-and-stores", "Object.freeze(o); try { o.a = 5; } catch (error) { return error.name + tell(o.a); } return tell(o.a);"],
  ["lists-its-keys", "return Object.keys(o).join();"],
  ["lists-its-entries", "return Object.entries(o).map(([name, value]) => name + tell(value)).join();"],
  ["walks-its-names", 'let names = ""; for (const name in o) names += name + ","; return names;'],
  ["spreads-it", "return show({ ...o });"],
  ["takes-it-apart", "const { a, b, ...rest } = o; return tell(a) + tell(b) + Object.keys(rest).join();"],
  ["prints-it-as-json", "return String(JSON.stringify(o));"],
  ["asks-for-its-class-by-name", "return tell(o.constructor?.name) + Object.prototype.toString.call(o);"],
  ["hands-it-to-unseen-code-and-reads", "Reflect.apply(touch, undefined, [o]); return tell(o.a) + tell(o.touched);"],
  ["puts-it-into-a-list-and-reads-it-back", "const held = [o, o]; return tell(held[place].a);"],
  ["puts-it-into-a-field-and-reads-it-back", "const holder = { held: o }; return tell(holder.held.b);"],
  ["captures-it", "const read = () => o.a; return tell(read());"],
  ["asks-again", "return tell(o instanceof Kind) + tell(o instanceof Heir) + tell(o instanceof Other);"],
  ["compares-it", "return tell(o === first) + tell(o == null) + tell(Object.is(o, o));"],
  ["reads-twice-round-a-call", "const before = o.a; touch(o); return tell(before) + tell(o.a);"],
]; // prettier-ignore

const prelude = `function tell(value) { return (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value)) + ";"; }
function show(o) {
  if (o === null || (typeof o !== "object" && typeof o !== "function")) return String(o);
  return Reflect.ownKeys(o).filter(name => typeof name === "string" && name !== "prototype").map(name => name + ":" + tell(o[name])).join("") + " below " + tell(Object.getPrototypeOf(o)?.constructor?.name) + (Object.isFrozen(o) ? "frozen" : "");
}
class Kind { a = 1; b = 2.5; tag = "kind"; #own = 7; sum() { return this.a + this.b; } get twice() { return this.a * 2; } own() { return this.#own; } static is(o) { return #own in o; } static ownOf(o) { return o.#own; } }
class Heir extends Kind { c = 3; sum() { return super.sum() + this.c; } }
class Last extends Heir { d = 4; get twice() { return -this.a; } }
class Other { a = 10; b = 20.5; tag = "other"; sum() { return -1; } get twice() { return -2; } }
function Old() { this.a = 100; this.b = 200.5; this.tag = "old"; }
Old.prototype.sum = function () { return this.a - this.b; };
class Young extends Old { c = 300; }
class Asked { static [Symbol.hasInstance](o) { return o != null && typeof o === "object" && "a" in o; } }
function makeKind() { return class Kind { a = 1; b = 2.5; tag = "kind"; sum() { return 1000; } }; }
function without(o) { delete o.a; return o; }
function again(o) { delete o.a; o.a = 1; return o; }
function gotten(o) { return Object.defineProperty(o, "a", { get() { return 41; }, set(value) {}, enumerable: true, configurable: true }); }
function touch(o) { if (o !== null && typeof o === "object" && Object.isExtensible(o)) { o.touched = 1; if (yes) o.a = 12; } }
function same(value) { return value; }
const key = JSON.parse('"a"'), unknown = JSON.parse("9"), place = Number("1"), three = Number("3"), yes = JSON.parse("true");
const first = new Kind();
function say(name, answer) { console.log(name, answer); }`;

/** Where the use stands: see write-form-sweep.ts. In a loop each `return` of the use is a word more of the answer. */
const places = ["straight", "in-a-loop-behind-the-question", "in-a-loop-with-the-question"] as const;
function laid(place: (typeof places)[number], open: string, block: string, close: string): string {
  if (place === "straight") return `${open} ${block} ${close} return "not taken";`;
  // A use that tells one value: the turn keeps the value, and it is told behind the loop: a turn that puts a text together is built otherwise than a quiet one.
  const one = /^((?:[^;]+; )*)return tell\(([^;]+)\);$/.exec(block);
  if (one && !/\) \+ /.test(one[2]) && !/\breturn\b/.test(one[1])) {
    const quiet = (inside: string) => `for (let turn = 0; turn < three; turn++) { ${inside} }`;
    return place === "in-a-loop-behind-the-question"
      ? `let last; ${open} ${quiet(`${one[1]}last = ${one[2]};`)} return tell(last); ${close} return "not taken";`
      : `let last, taken = 0; ${quiet(`${open} ${one[1]}last = ${one[2]}; taken++; ${close}`)} return taken ? tell(last) + taken : "not taken";`;
  }
  const deed = block.replace(/\breturn ([^;]+);/g, "{ answer += $1; continue turns; }");
  const loop = (inside: string) => `turns: for (let turn = 0; turn < three; turn++) { ${inside} }`;
  return place === "in-a-loop-behind-the-question"
    ? `let answer = ""; ${open} ${loop(deed)} return answer; ${close} return "not taken";`
    : `let answer = ""; ${loop(`${open} ${deed} ${close} answer += "not taken;";`)} return answer;`;
}
/**
 * Who comes. Three objects of classes that the compiler knows come to the one function, written at their calls: there a question about the class is answered by one look at the object. Then one odd object comes,
 * written at its call or through code that nobody has seen, and then an instance again. A program that held all the odd objects at once would have the compiler give up every proof, and show nothing.
 */
const regulars = objects.filter(([name]) => /^(?:an-instance|an-heir|of-another-class)$/.test(name));
const odd: [name: string, made: string][] = [["nobody-odd", ""], ...objects.filter(one => !regulars.includes(one))];
const comers = ["written", "through-unseen-code"] as const;

type Program = { name: string; text: string };
const all = questions.length * uses.length * places.length * comers.length * odd.length;
function write(at: number): Program {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const comer = take(comers);
  const place = take(places);
  const [stranger, made] = take(odd);
  const [question, open, close] = take(questions);
  const [use, block] = take(uses);
  // What the object looks like afterwards is read off it by name, where it was made. Handed to a function that lists its keys, it would have the compiler give up what it knows of the class: no question was
  // answered by one look then.
  const call = (name: string, given: string) =>
    `{ const made = ${given}; let answer; try { answer = use(made); } catch (error) { answer = "threw " + error.name; } say(${JSON.stringify(name)}, answer + " | " + (made == null ? "" : tell(made.a) + tell(made.b) + tell(made.tag) + tell(made.c) + tell(made.added))); }`;
  const calls = [
    ...regulars.map(([name, regular]) => call(name, regular)),
    ...(made ? [call(stranger, comer === "written" ? `(${made})` : `Reflect.apply(same, undefined, [${made}])`)] : []),
    ...regulars.map(([name, regular]) => call(name + "-again", regular)),
  ];
  return {
    name: `${question}--${use}--${place}--${stranger}--${comer}.mjs`,
    text: `${prelude}\nfunction use(o) { ${laid(place, open, block, close)} }\n${calls.join("\n")}\n`,
  };
}

const pad = (at: number) => String(at).padStart(6, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
