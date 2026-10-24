// A field that the program stores into and never reads by its name needs no room and no stores. It is still there for whoever asks the object what it holds: the lists of its keys, a copy,
// a text made of it, a read by a key that is computed, a comparison with another object.
// How the object is made x how the field is stored x who looks without naming it, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const common = `const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
function nameOf(at: number): string { return ["seen", "quiet", "absent"][at % 3]; }
function note(value: number): number { say("noted", value); return value; }
`;

/** Declares `Made`, and `makeOne(value)` answers one: `seen` is read by name somewhere, `quiet` never is. */
const makers: Record<string, string> = {
  literal: `type Made = { seen: number; quiet: number };\nfunction makeOne(value: number): Made { return { seen: value, quiet: value + 1 }; }`,
  literalQuietFirst: `type Made = { quiet: number; seen: number };\nfunction makeOne(value: number): Made { return { quiet: value + 1, seen: value }; }`,
  instance: `class Made { seen: number; quiet: number; constructor(value: number) { this.seen = value; this.quiet = value + 1; } }\nfunction makeOne(value: number): Made { return new Made(value); }`,
  instanceWithAFieldInitializer: `class Made { seen: number; quiet = note(7); constructor(value: number) { this.seen = value; } }\nfunction makeOne(value: number): Made { return new Made(value); }`,
  child: `class Parent { quiet: number; constructor(value: number) { this.quiet = value + 1; } }\nclass Made extends Parent { seen: number; constructor(value: number) { super(value); this.seen = value; } }\nfunction makeOne(value: number): Made { return new Made(value); }`,
  filledLater: `type Made = { seen: number; quiet?: number };\nfunction makeOne(value: number): Made { const made: Made = { seen: value }; made.quiet = value + 1; return made; }`,
  filledOnOneWay: `type Made = { seen: number; quiet?: number };\nfunction makeOne(value: number): Made { const made: Made = { seen: value }; if (value % 2) made.quiet = value + 1; return made; }`,
  ofAFunction: `type Made = { seen: number; quiet: number };\nfunction Old(this: Made, value: number) { this.seen = value; this.quiet = value + 1; }\nfunction makeOne(value: number): Made { return new (Old as unknown as new (value: number) => Made)(value); }`,
  holdsAnObject: `type Made = { seen: number; quiet: { deep: number } };\nfunction makeOne(value: number): Made { return { seen: value, quiet: { deep: value + 1 } }; }`,
  holdsAClosure: `type Made = { seen: number; quiet: () => number };\nfunction makeOne(value: number): Made { return { seen: value, quiet: () => value + 1 }; }`,
  holdsAText: `type Made = { seen: number; quiet: string };\nfunction makeOne(value: number): Made { return { seen: value, quiet: "q" + value }; }`,
  insideAnother: `type Made = { seen: number; inner: { quiet: number; seen: number } };\nfunction makeOne(value: number): Made { return { seen: value, inner: { quiet: value + 1, seen: value } }; }`,
};

const stores: Record<string, (turn: string) => string> = {
  noMore: () => ``,
  again: turn => `(it as any).quiet = ${turn} + 50;`,
  ofWhatACallAnswers: turn => `(it as any).quiet = note(${turn});`,
  inALoop: () => `for (let at = 0; at < 2; at++) (it as any).quiet = at;`,
  onOneWay: turn => `if (${turn} % 2) (it as any).quiet = 51;`,
};

const lookers: Record<string, (turn: string) => string> = {
  nobody: () => ``,
  keys: () => `say(Object.keys(it).join());`,
  values: () => `say(Object.values(it).map(String).join());`,
  entries: () => `say(Object.entries(it).map(String).join());`,
  text: () => `say(JSON.stringify(it));`,
  walk: () => `for (const key in it) say(key);`,
  spread: () => `say(Object.keys({ ...it }).join());`,
  rest: () => `const { seen, ...others } = it; say(seen, Object.keys(others).join());`,
  computedKey: turn => `say(String((it as any)[nameOf(${turn})]));`,
  computedKeyAsked: turn => `say(nameOf(${turn}) in it);`,
  hasOwn: turn => `say(Object.hasOwn(it, nameOf(${turn})));`,
  ownNames: () => `say(Object.getOwnPropertyNames(it).join(), Reflect.ownKeys(it).length);`,
  assign: () => `say(Object.keys(Object.assign({}, it)).join());`,
  clone: () => `try { say(Object.keys(structuredClone(it)).join()); } catch { say("no clone"); }`,
  inspect: () => `say(Bun.inspect(it).replace(/\\s+/g, " "));`,
  descriptor: () => `say(Object.keys(Object.getOwnPropertyDescriptors(it)).join());`,
  deepEquals: () => `say(Bun.deepEquals(it, { seen: it.seen }), Bun.deepEquals(it, makeOne(it.seen)));`,
  deleted: () => `say(delete (it as any).quiet, Object.keys(it).join());`,
  frozen: () => `Object.freeze(it); say(Object.isFrozen(it), Object.keys(it).length);`,
  unknownCode: () => `say(Object.keys(unknown(it)).length);`,
  unknownCodeReads: () => `say(String((unknown(it) as any).quiet));`,
  throughAny: () => `const loose: any = it; say(String(loose["qui" + "et"]));`,
  takenApartByAComputedKey: turn => `const { [nameOf(${turn})]: found } = it as any; say(String(found));`,
  mapOfEntries: () => `say(new Map(Object.entries(it)).size);`,
  withAProxy: () => `say(Object.keys(new Proxy(it, {})).join());`,
  asAPrototype: () => `say(String((Object.create(it) as any)[nameOf(1)]));`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 300;

const fewPlaces = ["once", "often", "loop", "handler", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "heldByAClosure", "inAClosureThatOutlivesItsMaker", "aroundAYield", "aroundAnAwait", "module"];

export function programs(isTyped?: boolean) {
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  let nth = 0;
  for (const maker in makers)
    for (const store in stores)
      for (const looker in lookers)
        (nth++ % 8 ? inFewPlaces : everywhere).push({
          name: `${maker}-${store}-${looker}`,
          beside: common + makers[maker] + "\n",
          before: seed => `let sum = ${seed};`,
          body: turn => `const it = makeOne(${turn}); ${stores[store](turn)} sum += it.seen; ${lookers[looker](turn)}`,
          after: "sum",
        });
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
