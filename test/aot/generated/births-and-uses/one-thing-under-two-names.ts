// A place in memory is read, something is stored through another name, and the place is read again. The second read may be answered by the first only if the two names cannot mean one thing.
// Here they sometimes do and sometimes do not. What is read x what is stored x how the second name came about, each in every place.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

type Thing = { type: string; beside?: string; make: (seed: string) => string; read: (name: string) => string; stores: Record<string, (name: string, value: string) => string> };
const XY = "{ x: number; y: number }";
const fieldStores: Thing["stores"] = {
  stores: (name, value) => `${name}.x = ${value};`,
  adds: (name, value) => `${name}.x += ${value};`,
  counts: name => `${name}.x++;`,
  storesTheNeighbor: (name, value) => `${name}.y = ${value};`,
  assigns: (name, value) => `Object.assign(${name}, { x: ${value} });`,
  takesApartInto: (name, value) => `({ x: ${name}.x } = { x: ${value} });`,
  storesUnderAKey: (name, value) => `${name}[key("x") as "x"] = ${value};`,
};
const things: Record<string, Thing> = {
  fieldOfALiteral: { type: XY, make: seed => `{ x: ${seed}, y: 2 }`, read: name => `${name}.x`, stores: { ...fieldStores, defines: (name, value) => `Object.defineProperty(${name}, "x", { value: ${value}, writable: true, enumerable: true, configurable: true });`, becomesAGetter: (name, value) => `Object.defineProperty(${name}, "x", { get: () => ${value} + 100, configurable: true });` } },
  fieldOfAnInstance: { type: "Point", beside: "class Point { x: number; y = 2; constructor(x: number) { this.x = x; } move(by: number): void { this.x += by; } }", make: seed => `new Point(${seed})`, read: name => `${name}.x`, stores: { ...fieldStores, callsAMethod: (name, value) => `${name}.move(${value});` } },
  optionalField: { type: "{ x?: number; y: number }", make: seed => `{ x: ${seed}, y: 2 }`, read: name => `${name}.x`, stores: { stores: (name, value) => `${name}.x = ${value};`, deletes: name => `delete ${name}.x;`, storesNothing: name => `${name}.x = undefined;` } },
  hiddenField: { type: "Hidden", beside: "class Hidden { #x: number; constructor(x: number) { this.#x = x; } get(): number { return this.#x; } set(x: number): void { this.#x = x; } static bump(it: Hidden): void { it.#x++; } }", make: seed => `new Hidden(${seed})`, read: name => `${name}.get()`, stores: { sets: (name, value) => `${name}.set(${value});`, bumps: name => `Hidden.bump(${name});` } },
  fieldOfAnInnerObject: { type: "{ inner: { x: number } }", make: seed => `{ inner: { x: ${seed} } }`, read: name => `${name}.inner.x`, stores: { stores: (name, value) => `${name}.inner.x = ${value};`, putsAnotherInside: (name, value) => `${name}.inner = { x: ${value} };`, throughTheInner: (name, value) => `const inner = ${name}.inner; inner.x = ${value};` } },
  inheritedField: { type: "{ x: number }", beside: "const above = { x: 1 };", make: seed => `(above.x = ${seed}, Object.create(above) as { x: number })`, read: name => `${name}.x`, stores: { storesItsOwn: (name, value) => `${name}.x = ${value};`, storesAbove: (_, value) => `above.x = ${value};`, putsItBelowAnother: (name, value) => `Object.setPrototypeOf(${name}, { x: ${value} });` } },
  element: { type: "number[]", make: seed => `[${seed}, 2, 3]`, read: name => `${name}[0]`, stores: { stores: (name, value) => `${name}[0] = ${value};`, storesAtAnIndex: (name, value) => `${name}[(${value}) % 2] = ${value};`, shifts: name => `${name}.shift();`, putsInFront: (name, value) => `${name}.unshift(${value});`, fills: (name, value) => `${name}.fill(${value});`, turnsAround: name => `${name}.reverse();`, cuts: name => `${name}.length = 0;`, storesAFraction: name => `${name}[0] = 0.5;`, copiesWithin: name => `${name}.copyWithin(0, 1);` } },
  length: { type: "number[]", make: seed => `[${seed}, 2, 3]`, read: name => `${name}.length`, stores: { pushes: (name, value) => `${name}.push(${value});`, pops: name => `${name}.pop();`, storesBehindTheEnd: (name, value) => `${name}[${name}.length] = ${value};`, storesFarBehindTheEnd: (name, value) => `${name}[${name}.length + 3] = ${value};`, storesTheLength: name => `${name}.length = 1;`, splices: name => `${name}.splice(1, 1);` } },
  lastElement: { type: "number[]", make: seed => `[${seed}, 2, 3]`, read: name => `${name}[${name}.length - 1]`, stores: { pushes: (name, value) => `${name}.push(${value});`, pops: name => `${name}.pop();`, sorts: name => `${name}.sort((a, b) => b - a);` } },
  elementOfWholeNumbers: { type: "Int32Array", make: seed => `new Int32Array([${seed}, 2, 3])`, read: name => `${name}[0]`, stores: { stores: (name, value) => `${name}[0] = ${value};`, throughBytes: (name, value) => `new Uint8Array(${name}.buffer)[1] = ${value};`, throughAView: (name, value) => `new DataView(${name}.buffer).setInt16(0, ${value});`, sets: (name, value) => `${name}.set([${value}]);`, throughAPart: (name, value) => `${name}.subarray(0, 1)[0] = ${value};` } },
  entryOfAMap: { type: "Map<string, number>", make: seed => `new Map([["k", ${seed}]])`, read: name => `${name}.get("k")`, stores: { sets: (name, value) => `${name}.set("k", ${value});`, deletes: name => `${name}.delete("k");`, clears: name => `${name}.clear();` } },
  sizeOfASet: { type: "Set<number>", make: seed => `new Set([${seed}])`, read: name => `${name}.size`, stores: { adds: (name, value) => `${name}.add(${value} + 50);`, clears: name => `${name}.clear();` } },
  lengthOfATextInAField: { type: "{ x: string }", make: seed => `{ x: "t" + ${seed} }`, read: name => `${name}.x.length`, stores: { stores: (name, value) => `${name}.x = "longer" + ${value};`, adds: (name, value) => `${name}.x += ${value};` } },
  whetherAFieldIsThere: { type: "{ x?: number; y: number }", make: seed => `{ x: ${seed}, y: 2 }`, read: name => `("x" in ${name}) + ":" + Object.keys(${name}).length`, stores: { deletes: name => `delete ${name}.x;`, addsAnother: (name, value) => `(${name} as Record<string, number>)["z" + (${value}) % 2] = 1;` } },
};

type Naming = { declare?: (type: string, work: string) => string; before?: (type: string, work: string) => string; call?: (turn: string) => string; names?: (turn: string) => string };
const namings: Record<string, Naming> = {
  chosenByATest: { names: turn => `const a = one, b = (${turn}) % 2 ? one : two;` },
  twoParameters: { declare: (type, work) => `function work(a: ${type}, b: ${type}, now: number): void { ${work} }`, call: turn => `work(one, (${turn}) % 2 ? one : two, ${turn});` },
  outOfAList: { names: turn => `const both = [one, two, one]; const a = one, b = both[(${turn}) % 3];` },
  outOfAField: { names: turn => `const holder = { it: (${turn}) % 2 ? one : two }; const a = one, b = holder.it;` },
  outOfACall: { declare: type => `function pick(first: ${type}, second: ${type}, turn: number): ${type} { return turn % 2 ? first : second; }`, names: turn => `const a = one, b = pick(one, two, ${turn});` },
  heldByAClosure: { before: () => `let chosen = two; const other = () => chosen;`, names: turn => `chosen = (${turn}) % 2 ? one : two; const a = one, b = other();` },
  thisAndAParameter: { declare: (type, work) => `class Worker { a: ${type}; constructor(a: ${type}) { this.a = a; } work(b: ${type}, now: number): void { const a = this.a; ${work} } }`, call: turn => `new Worker(one).work((${turn}) % 2 ? one : two, ${turn});` },
  throughUnknown: { declare: type => `function hide(value: unknown): unknown { return value; }`, names: turn => `const a = one, b = hide((${turn}) % 2 ? one : two) as typeof one;` },
  alwaysTheSame: { names: () => `const a = one, b = one;` },
};

const patterns: Record<string, (read: string, store: string, storeThroughFirst: string) => string> = {
  readStoreRead: (read, store) => `say(${read}); ${store} say(${read});`,
  storeOnSomeTurns: (read, store) => `say(${read}); if (now % 3) { ${store} } say(${read});`,
  readOnBothWays: (read, store) => `if (now % 2) say("odd", ${read}); else say("even", ${read}); { ${store} } say(${read});`,
  storeStoreRead: (read, store, first) => `{ ${first} } { ${store} } say(${read});`,
  readInALoop: (read, store) => `for (let at = 0; at < 3; at++) { say(${read}); if (at === 1) { ${store} } }`,
};

function stretch(thingName: string, storeName: string, namingName: string, patternName: string): Stretch {
  const [thing, naming] = [things[thingName], namings[namingName]];
  const work = patterns[patternName](thing.read("a"), thing.stores[storeName]("b", "now + 20"), thing.stores[storeName]("a", "now + 40"));
  return {
    name: `${thingName}-${storeName}-${namingName}-${patternName}`,
    beside: `function key(name: string): string { return said.length > 100000 ? "none" : name; }\n${thing.beside ?? ""}\n${naming.declare?.(thing.type, work) ?? ""}`,
    before: seed => `const one: ${thing.type} = ${thing.make(seed)}; const two: ${thing.type} = ${thing.make(`${seed} + 5`)}; ${naming.before?.(thing.type, work) ?? ""}`,
    body: turnText => naming.call?.(turnText) ?? `const now = ${turnText}; ${naming.names!("now")} ${work}`,
    after: `String(${thing.read("one")}) + "/" + String(${thing.read("two")})`,
  };
}

export const oneIn = 60;

export function programs(isTyped?: boolean) {
  const patternNames = Object.keys(patterns);
  const all: Stretch[] = [];
  let at = 0;
  for (const thing in things) for (const store in things[thing].stores) for (const naming in namings) all.push(stretch(thing, store, naming, patternNames[at++ % patternNames.length]));
  return inEveryPlace(all, isTyped);
}
