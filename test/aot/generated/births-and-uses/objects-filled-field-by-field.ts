// An object gets its fields one store after another. From the last of those stores on, every field may be taken to be there, in its place and in the order of the stores: unless something
// came between them. Somebody kept the half-filled object, listed its keys, deleted a field, stored a later one first, made one an accessor, froze it, threw, or collected garbage.
// How the object is made x what comes between two stores x what is asked of it afterwards, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Maker = { declare: (between: (self: string) => string | undefined) => string | undefined; make: (seed: string) => string };
const wrap = (text: (between: string) => string, self: string): Maker["declare"] => between => { const made = between(self); return made === undefined ? undefined : text(made); };
const makers: Record<string, Maker> = {
  constructorStores: { declare: wrap(b => `class Thing { a: number; b: string; c: number; constructor(seed: number) { this.a = seed; ${b} this.b = "b" + seed; this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
  beforeTheLastStore: { declare: wrap(b => `class Thing { a: number; b: string; c: number; constructor(seed: number) { this.a = seed; this.b = "b" + seed; ${b} this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
  beforeTheFirstStore: { declare: wrap(b => `class Thing { a: number; b: string; c: number; constructor(seed: number) { ${b} this.a = seed; this.b = "b" + seed; this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
  initialValues: { declare: wrap(b => `function interrupt(self: Thing): string { ${b} return "b"; }\nclass Thing { a: number = 1; b: string = interrupt(this); c: number = 3; constructor(seed: number) { this.a += seed; } }`, "self"), make: seed => `new Thing(${seed})` },
  inTheParent: { declare: wrap(b => `class Base { a: number; constructor(seed: number) { this.a = seed; ${b} } }\nclass Thing extends Base { b: string; c: number; constructor(seed: number) { super(seed); this.b = "b" + seed; this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
  behindTheParent: { declare: wrap(b => `class Base { a: number; constructor(seed: number) { this.a = seed; } }\nclass Thing extends Base { b: string; c: number; constructor(seed: number) { super(seed); this.b = "b" + seed; ${b} this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
  plainFunction: { declare: wrap(b => `interface Thing { a: number; b: string; c: number }\nfunction ThingMaker(this: Thing, seed: number) { this.a = seed; ${b} this.b = "b" + seed; this.c = seed + 2; }\nconst Thing = ThingMaker as unknown as new (seed: number) => Thing;`, "this"), make: seed => `new Thing(${seed})` },
  filledFromOutside: { declare: wrap(b => `class Thing { a!: number; b!: string; c!: number; }\nfunction fill(seed: number): Thing { const made = new Thing(); made.a = seed; ${b} made.b = "b" + seed; made.c = seed + 2; return made; }`, "made"), make: seed => `fill(${seed})` },
  literalFilledLater: { declare: wrap(b => `type Thing = { a: number; b: string; c: number };\nfunction fill(seed: number): Thing { const made = { a: seed } as Thing; ${b} made.b = "b" + seed; made.c = seed + 2; return made; }`, "made"), make: seed => `fill(${seed})` },
  inAnotherOrder: { declare: wrap(b => `class Thing { a: number; b: string; c: number; constructor(seed: number) { this.c = seed + 2; ${b} this.a = seed; this.b = "b" + seed; } }`, "this"), make: seed => `new Thing(${seed})` },
  onTwoWays: { declare: wrap(b => `class Thing { a: number; b: string; c: number; constructor(seed: number) { if (seed % 2) { this.a = seed; ${b} this.b = "b" + seed; this.c = seed + 2; } else { this.c = seed; this.b = "e"; this.a = -seed; } } }`, "this"), make: seed => `new Thing(${seed})` },
  oneStoreOnSomeWays: { declare: wrap(b => `class Thing { a: number; b!: string; c: number; constructor(seed: number) { this.a = seed; ${b} if (seed % 2) this.b = "b" + seed; this.c = seed + 2; } }`, "this"), make: seed => `new Thing(${seed})` },
};

const betweens: Record<string, (self: string) => string | undefined> = {
  nothing: () => "",
  itIsKept: self => `seen.push(${self});`,
  itIsKeptAndWritten: self => `seen.push(${self}); say(JSON.stringify(${self}));`,
  itsKeysAreListed: self => `say(Object.keys(${self}).join("+"));`,
  aFieldIsRead: self => `say(${self}.a, ${self}.c);`,
  aStoredFieldIsDeleted: self => `delete open(${self}).a;`,
  aLaterFieldIsStored: self => `open(${self}).c = -1;`,
  aLaterFieldIsStoredAndDeleted: self => `open(${self}).c = -1; delete open(${self}).c;`,
  aLaterFieldBecomesAnAccessor: self => `Object.defineProperty(${self}, "c", { get() { return -7; }, set() {}, enumerable: true, configurable: true });`,
  aLaterFieldIsFixed: self => `Object.defineProperty(${self}, "c", { value: -9, writable: false, enumerable: true, configurable: true });`,
  anotherFieldIsAdded: self => `open(${self}).extra = 1;`,
  itIsFrozen: self => `Object.freeze(${self});`,
  itTakesNoMoreFields: self => `Object.preventExtensions(${self});`,
  itGoesBelowAnother: self => `Object.setPrototypeOf(${self}, { inherited: 1 });`,
  itIsKeptAndTheMakerThrows: self => `seen.push(${self}); fail(seen.length % 2 === 0);`,
  theMakerReturns: self => (self === "this" ? `if (seen.push(this) % 2) return;` : self === "made" ? `if (seen.push(made) % 2) return made;` : undefined),
  aClosureHoldsIt: self => `later.push(() => JSON.stringify(${self}));`,
  oneOfSeveralFunctionsIsGivenIt: self => `hooks[calls++ % hooks.length](${self});`,
  garbageIsCollected: () => `Bun.gc(true);`,
  itIsKeptAndGarbageIsCollected: self => `seen.push(${self}); Bun.gc(true);`,
};

const readers: Record<string, (make: (seed: string) => string, turn: string) => string> = {
  readsEveryField: () => `say(one.a, one.b, one.c);`,
  listsTheKeys: () => `say(Object.keys(one).join("+"));`,
  writesItAsText: () => `say(JSON.stringify(one));`,
  asksForNames: () => `say("a" in one, Object.hasOwn(one, "b"), "c" in one);`,
  walksTheKeys: () => `for (const key in one) say(key);`,
  copiesIt: () => `const copy = { ...one }; say(Object.keys(copy).join("+"), copy.c);`,
  listsTheEntries: () => `say(Object.entries(one).join("|"));`,
  addsThemUp: () => `let sum = 0; for (let at = 0; at < 5; at++) sum += total(one); say(sum);`,
  storesEveryField: () => `one.a = 10; one.b = "again"; one.c = 30; say(JSON.stringify(one));`,
  makesOneInTheTurn: (make, turn) => `const fresh = ${make(turn)}; say(JSON.stringify(fresh), Object.keys(fresh).join("+"), fresh.c);`,
};

function stretch(makerName: string, betweenName: string, readerName: string): Stretch | undefined {
  const maker = makers[makerName];
  const declared = maker.declare(betweens[betweenName]);
  if (declared === undefined) return undefined;
  return {
    name: `${makerName}-${betweenName}-${readerName}`,
    beside: `const seen: Thing[] = [];
const later: (() => string)[] = [];
let calls = 0;
function open(it: object): Record<string, unknown> { return it as Record<string, unknown>; }
const hooks: ((it: Thing) => void)[] = [() => {}, it => { delete open(it).a; }, it => { open(it).c = "early"; }];
${declared}
function total(one: Thing): number { return one.a + one.c + String(one.b).length; }
function left(): string { const text = seen.map(each => JSON.stringify(each) + Object.keys(each).join("+")).join("|") + "/" + later.map(each => each()).join("|"); seen.length = 0; later.length = 0; return text; }`,
    before: seed => `const things: Thing[] = []; for (let at = 0; at < 3; at++) { try { things.push(${maker.make(`${seed} + at`)}); } catch (error) { say("failed", (error as Error).name); } }`,
    body: turn => `const one = things[(${turn}) % 3] ?? seen[0]; if (one) { ${readers[readerName](maker.make, turn)} }`,
    after: "left()",
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "loopThatStartsAnew", "twoLoopsStartedBetween", "handlerInALoop", "loopUnderAHandler", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 150;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const maker in makers)
    for (const between in betweens)
      for (const reader in readers) {
        const made = stretch(maker, between, reader);
        if (made) all.push(made);
      }
  return inEveryPlace(all, isTyped, somePlaces);
}
