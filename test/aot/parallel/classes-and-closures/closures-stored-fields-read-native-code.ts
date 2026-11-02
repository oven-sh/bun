// Native code that walks an object meets members whose function objects nobody has made yet. It sees functions, the very ones that a later read gives, and undefined and null where a store put them.
import { inspect, isDeepStrictEqual } from "node:util";
import { serialize } from "node:v8";

const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

interface Kit {
  label: string;
  first: () => number;
  maybe: (() => string) | undefined | null;
  own: () => string;
}
let calls = 0;
function kit(label: string): Kit {
  const made = {
    label,
    first: () => ++calls,
    maybe: () => label + " maybe",
  } as Kit;
  made.own = () => made.label + " owns";
  return made;
}
function without(label: string, nothing: undefined | null): Kit {
  const made = kit(label);
  made.maybe = nothing;
  return made;
}

class Handler {
  label: string;
  own = () => this.label + " handles";
  maybe: (() => string) | undefined | null = () => "maybe " + this.label;
  constructor(label: string, nothing?: null) {
    this.label = label;
    if (nothing !== undefined || label === "nothing") this.maybe = nothing;
  }
}

function onOneLine(text: string) {
  return text.replace(/\s+/g, " ");
}
function nameOfWhatIsThrown(run: () => unknown) {
  try {
    run();
    return "nothing";
  } catch (error) {
    return (error as Error).name;
  }
}
// What a reader saw must be what a read gives afterwards, and the functions still capture their own object.
function stillWhole(made: Kit) {
  const own = made.own;
  const maybe = made.maybe;
  return [own === made.own, own(), maybe === made.maybe, maybe ? maybe() : String(maybe), typeof made.first].join(" ");
}

// Printing.
console.log(kit("printed"));
console.log(without("printed", undefined), without("printed", null));
console.log(new Handler("printed"), new Handler("nothing"), new Handler("printed", null));
say("inspect", onOneLine(inspect(kit("a"))), onOneLine(inspect(without("a", null))), onOneLine(inspect(without("a", undefined))));
say("Bun.inspect", onOneLine(Bun.inspect(kit("b"))), onOneLine(Bun.inspect(new Handler("b"))), onOneLine(Bun.inspect(new Handler("b", null))));
const printed = kit("c");
inspect(printed);
say("after inspect", stillWhole(printed));

// Deep equality.
const compared = kit("d");
say("deep", isDeepStrictEqual(compared, compared), isDeepStrictEqual(kit("d"), kit("d")), Bun.deepEquals(compared, compared), Bun.deepEquals(kit("d"), kit("d")));
say("deep with nothing", isDeepStrictEqual(without("d", null), without("d", undefined)), Bun.deepEquals(without("d", null), without("d", null), true));
const comparedWithCopy = kit("e");
say("deep with copy", isDeepStrictEqual(comparedWithCopy, { ...comparedWithCopy }), Bun.deepEquals(comparedWithCopy, { ...comparedWithCopy }, true), stillWhole(comparedWithCopy));

// Serializers: a function cannot be cloned, undefined and null can.
const cloned = kit("f");
say("structuredClone", nameOfWhatIsThrown(() => structuredClone(cloned)), stillWhole(cloned));
const sent = kit("g");
const { port1, port2 } = new MessageChannel();
say("postMessage", nameOfWhatIsThrown(() => port1.postMessage(sent)), stillWhole(sent));
port1.close();
port2.close();
const serialized = kit("h");
say("serialize", nameOfWhatIsThrown(() => serialize(serialized)), stillWhole(serialized));
say("JSON", JSON.stringify(kit("i")), JSON.stringify(without("i", null)), JSON.stringify(without("i", undefined)), JSON.stringify([new Handler("i"), new Handler("i", null), new Handler("nothing")]));
say("JSON with replacer", JSON.stringify(kit("j"), (key, value) => (typeof value === "function" ? "function " + key : value)), JSON.stringify(without("j", undefined), (key, value) => (value === undefined ? "undefined " + key : typeof value === "function" ? 1 : value)));

// The collector and the heap snapshots.
const collected: Kit[] = [];
for (let i = 0; i < 200; i++) collected.push(i % 3 === 0 ? kit("k" + i) : without("k" + i, i % 3 === 1 ? null : undefined));
Bun.gc(true);
say("snapshots", typeof Bun.generateHeapSnapshot(), typeof Bun.generateHeapSnapshot("v8"));
Bun.gc(true);
say("after collections", stillWhole(collected[0]), "|", stillWhole(collected[1]), "|", stillWhole(collected[2]), "|", stillWhole(collected[198]), new Set(collected.map(each => each.own)).size);

// Listing and copying by the standard library.
const listed = kit("l");
const fromEntries = Object.fromEntries(Object.entries(listed)) as unknown as Kit;
say("fromEntries", fromEntries.own === listed.own, fromEntries.first === listed.first, fromEntries.maybe === listed.maybe, fromEntries.own());
const described = kit("m");
const redefined = Object.defineProperties({}, Object.getOwnPropertyDescriptors(described)) as Kit;
say("descriptors", redefined.own === described.own, redefined.maybe === described.maybe, redefined.own(), Object.keys(redefined).join());
say("descriptor of nothing", JSON.stringify(Object.getOwnPropertyDescriptor(without("m", null), "maybe")), JSON.stringify(Object.getOwnPropertyDescriptor(without("m", undefined), "maybe")), "maybe" in without("m", undefined), Object.hasOwn(without("m", null), "maybe"));
const reflected = kit("n");
say("Reflect", Reflect.get(reflected, "own") === reflected.own, Reflect.has(reflected, "maybe"), Reflect.ownKeys(reflected).join(), Reflect.get(without("n", null), "maybe"), Reflect.get(without("n", undefined), "maybe"));
say("values", Object.values(kit("o")).map(value => typeof value).join(), Object.values(without("o", null)).map(String)[2], Object.values(without("o", undefined)).map(String)[2]);
const keysInLoop: string[] = [];
for (const key in without("p", null)) keysInLoop.push(key);
say("for in", keysInLoop.join());
const { label, ...rest } = kit("q");
say("rest", label, Object.keys(rest).join(), rest.own(), typeof rest.maybe);
const restOfNothing = (({ label, ...others }: Kit) => others)(without("q", null));
say("rest of nothing", Object.keys(restOfNothing).join(), restOfNothing.maybe, restOfNothing.own());

// Integrity levels, set before anybody has read a member.
const frozen = Object.freeze(kit("s"));
say("frozen", Object.isFrozen(frozen), stillWhole(frozen), nameOfWhatIsThrown(() => ((frozen as Kit).own = () => "other")), frozen.own());
const sealed = Object.seal(without("t", null));
say("sealed", Object.isSealed(sealed), stillWhole(sealed), nameOfWhatIsThrown(() => delete (sealed as Partial<Kit>).own));
sealed.maybe = () => "late";
say("sealed and stored", stillWhole(sealed));

// Behind a proxy, and as a prototype.
const target = kit("u");
const proxy = new Proxy(target, {});
say("proxy", proxy.own === target.own, proxy.own(), Object.keys(proxy).join());
const base = kit("v");
const heir = Object.create(base) as Kit;
say("heir", heir.own === base.own, heir.own(), Object.keys(heir).length, "maybe" in heir);
heir.label = "heir";
say("heir with its own label", heir.own(), base.label);

// Nothing, then a function, then nothing again.
const turning = without("w", undefined);
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(turning.maybe ? turning.maybe() : String(turning.maybe));
  turning.maybe = i % 3 === 0 ? () => "turn " + i : i % 3 === 1 ? null : undefined;
}
say("turning", seen.join());
say("optional calls", without("x", null).maybe?.(), without("x", undefined).maybe?.(), kit("x").maybe?.(), new Handler("x").maybe?.(), new Handler("x", null).maybe?.(), new Handler("nothing").maybe?.());
say("defaults", (without("y", null).maybe ?? (() => "default"))(), (kit("y").maybe ?? (() => "default"))(), typeof without("y", undefined).maybe, typeof without("y", null).maybe, typeof kit("y").maybe);

console.log(lines.join("\n"));
