// A walk over the keys of an object whose fields are known can be laid out as one step for each field, without a list of keys. The order of the keys, which of them count, what a getter
// does when its turn comes, and what becomes of keys that are deleted, added or hidden while the walk is under way stay what they are for a walk over a real list.
// What the object is x how it is walked x what a turn of the walk does to it, each in some places.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const objects: Record<string, { beside?: string; make: (seed: string) => string }> = {
  literal: { make: seed => `{ a: ${seed}, b: "two", c: 3 }` },
  instance: { beside: "class Thing { a: number; b = \"two\"; c = 3; constructor(a: number) { this.a = a; } method(): number { return 1; } }", make: seed => `new Thing(${seed})` },
  instanceOfAChild: { beside: "class Parent { a: number; constructor(a: number) { this.a = a; } }\nclass Child extends Parent { b = \"two\"; c = 3; }", make: seed => `new Child(${seed})` },
  numbersAmongTheNames: { make: seed => `{ b: "two", 2: "n2", a: ${seed}, 1: "n1", c: 3 }` },
  withASymbol: { beside: `const mark = Symbol("mark");`, make: seed => `{ a: ${seed}, [mark]: "hidden", b: "two", c: 3 }` },
  withAHiddenField: { make: seed => `Object.defineProperty({ a: ${seed}, b: "two", c: 3 }, "b", { enumerable: false })` },
  withAGetter: { make: seed => `{ a: ${seed}, get b() { say("got b"); return "two"; }, c: 3 }` },
  withAGetterThatDeletes: { make: seed => `{ a: ${seed}, get b() { delete (this as { c?: number }).c; return "two"; }, c: 3 }` },
  belowAnObjectWithKeys: { make: seed => `Object.assign(Object.create({ inherited: 1, c: "above" }) as object, { a: ${seed}, b: "two", c: 3 })` },
  withoutAPrototype: { make: seed => `Object.assign(Object.create(null) as object, { a: ${seed}, b: "two", c: 3 })` },
  list: { make: seed => `Object.assign([${seed}, "two"], { c: 3 })` },
  listWithAHole: { make: seed => `[${seed}, , "two"]` },
  functionWithFields: { make: seed => `Object.assign(function named() {}, { a: ${seed}, b: "two", c: 3 })` },
  filledInALoop: { make: seed => `(() => { const made: Record<string, unknown> = {}; for (const key of ["a", "b", "c"]) made[key] = key + ${seed}; return made; })()` },
  frozen: { make: seed => `Object.freeze({ a: ${seed}, b: "two", c: 3 })` },
  sealed: { make: seed => `Object.seal({ a: ${seed}, b: "two", c: 3 })` },
  withAFieldDeleted: { make: seed => `(() => { const made: { a: number; b?: string; c: number } = { a: ${seed}, b: "two", c: 3 }; delete made.b; return made; })()` },
  withAFieldDeletedAndStoredAgain: { make: seed => `(() => { const made: { a?: number; b: string; c: number } = { a: 0, b: "two", c: 3 }; delete made.a; made.a = ${seed}; return made; })()` },
  withAFieldMore: { make: seed => `(() => { const made: Record<string, unknown> = { a: ${seed}, b: "two", c: 3 }; made.d = 4; return made; })()` },
  oneOfTwoShapes: { make: seed => `(${seed} % 2 ? { a: ${seed}, b: "two", c: 3 } : { c: 3, a: ${seed} })` },
  outOfAText: { make: seed => `JSON.parse('{"a":' + ${seed} + ',"b":"two","c":3}')` },
  behindAProxy: { make: seed => `new Proxy({ a: ${seed}, b: "two", c: 3 }, { ownKeys(target) { say("keys asked"); return Reflect.ownKeys(target).reverse(); } })` },
  empty: { make: () => `{}` },
};

const durings: Record<string, string> = {
  nothing: "",
  deletesALaterKey: `delete it.c;`,
  deletesThisKey: `delete it[key];`,
  addsAKey: `if (Object.isExtensible(it)) it.z = 26;`,
  storesALaterValue: `if (!Object.isFrozen(it)) it.c = "stored";`,
  hidesALaterKey: `if (!Object.isFrozen(it) && "c" in it) Object.defineProperty(it, "c", { enumerable: false });`,
  putsItBelowAnother: `Object.setPrototypeOf(it, { late: 1 });`,
  leaves: `if (key === "b") break;`,
  throws: `fail(key === "b");`,
};

const loops: Record<string, (during: string) => string> = {
  forIn: during => `for (const key in it) { say(key, String(it[key])); ${during} }`,
  forInOwnOnly: during => `for (const key in it) { if (!Object.hasOwn(it, key)) continue; say(key); ${during} }`,
  keys: during => `for (const key of Object.keys(it)) { say(key, String(it[key])); ${during} }`,
  keysByIndex: during => `const keys = Object.keys(it); for (let at = 0; at < keys.length; at++) { const key = keys[at]; say(key, String(it[key])); ${during} }`,
  entries: during => `for (const [key, value] of Object.entries(it)) { say(key, String(value)); ${during} }`,
  names: during => `for (const key of Object.getOwnPropertyNames(it)) { say(key); ${during} }`,
};
const others: Record<string, string> = {
  keysForEach: `Object.keys(it).forEach(key => say(key, String(it[key])));`,
  howMany: `say(Object.keys(it).length, Object.values(it).length);`,
  values: `for (const value of Object.values(it)) say(String(value));`,
  entriesJoined: `say(Object.entries(it).map(([key, value]) => key + "=" + String(value)).join("&"));`,
  assigned: `say(Object.keys(Object.assign({}, it)).join("+"));`,
  spread: `const copy = { ...it }; say(Object.keys(copy).join("+"), String(copy.c));`,
  theRest: `const { a, ...rest } = it; say(String(a), Object.keys(rest).join("+"));`,
  asText: `say(JSON.stringify(it));`,
  everyKey: `say(Reflect.ownKeys(it).map(String).join("+"));`,
  oneKeyAsked: `say(Object.keys(it).includes("b"), Object.keys(it)[1], Object.keys(it).indexOf("c"));`,
  keysSorted: `say(Object.keys(it).sort().reverse().join("+"));`,
  fromEntries: `say(JSON.stringify(Object.fromEntries(Object.entries(it).map(([key, value]) => [key + key, String(value)]))));`,
};

function stretch(objectName: string, walkName: string, walk: string): Stretch {
  const object = objects[objectName];
  return {
    name: `${objectName}-${walkName}`,
    beside: object.beside,
    before: seed => `const start = ${seed};`,
    body: turn => `const it = ${object.make(`(start + (${turn}))`)} as unknown as Record<string, unknown>; ${walk} say("|", Object.keys(it).join("+"));`,
    after: `"end"`,
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "twoLoops", "loopWithContinue", "handlerInALoop", "loopUnderAHandler", "cleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 60;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const object in objects) {
    for (const loop in loops) for (const during in durings) all.push(stretch(object, `${loop}-${during}`, loops[loop](durings[during])));
    for (const other in others) all.push(stretch(object, other, others[other]));
  }
  return inEveryPlace(all, isTyped, somePlaces);
}
