// COUNTER: FieldsLeftSlotByDelete >= 100
// COUNTER: FieldsLeftSlotByRedefinition >= 90
// COUNTER: ObjectsGivenIntegrityLevel >= 50
// No statement of the program deletes a property of these objects, freezes one, or defines one by a descriptor. Code that the build has not seen does all of it,
// between two accesses of one function, in the middle of a loop and below two calls.
import vm from "node:vm";

class Pair {
  first: number;
  second: string;
  declare third: number[] | undefined;
  constructor(seed: number) {
    this.first = seed;
    this.second = "s" + seed;
    if (seed % 2) this.third = [seed];
  }
  total(): number {
    return this.first + this.second.length;
  }
}

type Deed = (pair: Pair) => void;

let calls = 0;
(globalThis as any).noteCall = () => ++calls;

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function attempt(act: () => unknown): string {
  try {
    return show(act());
  } catch (error) {
    return (error as Error).name;
  }
}

function look(pair: Pair): string {
  return [
    attempt(() => pair.first),
    attempt(() => pair.second),
    attempt(() => pair.third),
    attempt(() => pair.total()),
    attempt(() => "first" in pair),
    attempt(() => Object.hasOwn(pair, "second")),
    attempt(() => Object.keys(pair).join()),
    attempt(() => JSON.stringify(pair)),
    attempt(() => ({ ...pair })),
    attempt(() => {
      let names = "";
      for (const name in pair) names += name;
      return names;
    }),
    attempt(() => Object.isFrozen(pair) + "" + Object.isSealed(pair) + Object.isExtensible(pair)),
    attempt(() => JSON.stringify(Object.getOwnPropertyDescriptor(pair, "first"))),
  ].join(" ");
}

function store(pair: Pair): string {
  return [
    attempt(() => (pair.first = 70)),
    attempt(() => (pair.second = "seventy")),
    attempt(() => (pair.third = [70])),
    attempt(() => ((pair as any).fourth = 4)),
    attempt(() => pair.first++),
    attempt(() => delete (pair as any).third),
  ].join(" ");
}

function between(pair: Pair, deed: Deed): string {
  const before = pair.first + pair.second;
  deed(pair);
  return before + " " + attempt(() => pair.first + pair.second) + " " + look(pair);
}

function storesBetween(pair: Pair, deed: Deed): string {
  pair.first = 1;
  pair.second = "one";
  deed(pair);
  return store(pair) + " > " + look(pair);
}

function inLoop(pair: Pair, deed: Deed): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    if (turn === 5) deed(pair);
    text += attempt(() => {
      pair.first = turn;
      return pair.first + pair.second.length;
    });
    text += ";";
  }
  return text + look(pair);
}

function lowest(pair: Pair, deed: Deed): unknown {
  deed(pair);
  return pair.first;
}

function belowCalls(pair: Pair, deed: Deed): string {
  const first = pair.first;
  const low = attempt(() => lowest(pair, deed));
  return first + low + attempt(() => pair.first) + attempt(() => (pair.first = 5)) + attempt(() => pair.first);
}

const unseen = (text: string): any => (0, eval)(text);

const deeds: [string, Deed][] = [
  ["delete by name", unseen("p => { delete p.first; }")],
  ["delete under a computed key", unseen("p => { for (const k of ['second', 'first']) delete p[k]; }")],
  ["Reflect.deleteProperty", unseen("p => { Reflect.deleteProperty(p, 'first'); }")],
  ["delete through a proxy", unseen("p => { delete new Proxy(p, {}).second; }")],
  ["delete in another realm", vm.runInNewContext("p => { delete p.first; }")],
  ["delete and create again", unseen("p => { delete p.first; p.first = 8; }")],
  ["delete all and create in another order", unseen("p => { delete p.first; delete p.second; delete p.third; p.third = [1]; p.second = 't'; p.first = 2; }")],
  ["Object.freeze", unseen("p => { Object.freeze(p); }")],
  ["Object.freeze handed over as a value", unseen("Object.freeze")],
  ["Object.seal", unseen("p => { Object.seal(p); }")],
  ["Object.preventExtensions", unseen("p => { Object.preventExtensions(p); }")],
  ["Reflect.preventExtensions", unseen("p => { Reflect.preventExtensions(p); }")],
  ["freeze through a proxy", unseen("p => { Object.freeze(new Proxy(p, {})); }")],
  ["freeze in another realm", vm.runInNewContext("p => { Object.freeze(p); }")],
  ["read only", unseen("p => { Object.defineProperty(p, 'first', { writable: false }); }")],
  ["read only with another value", unseen("p => { Object.defineProperty(p, 'first', { value: 'fixed', writable: false }); }")],
  ["hidden from lists", unseen("p => { Object.defineProperty(p, 'first', { enumerable: false }); }")],
  ["fixed", unseen("p => { Object.defineProperty(p, 'second', { configurable: false }); }")],
  ["getter", unseen("p => { Object.defineProperty(p, 'first', { get() { return 100 + noteCall(); }, configurable: true, enumerable: true }); }")],
  ["getter and setter", unseen("p => { let held = 1; Object.defineProperty(p, 'first', { get() { noteCall(); return held; }, set(v) { noteCall(); held = v * 2; }, configurable: true }); }")],
  ["setter alone", unseen("p => { Object.defineProperty(p, 'second', { set(v) { noteCall(); } }); }")],
  ["__defineGetter__", unseen("p => { p.__defineGetter__('second', () => 'got' + noteCall()); }")],
  ["accessor, then a value again", unseen("p => { Object.defineProperty(p, 'first', { get() { return 1; }, configurable: true }); Object.defineProperty(p, 'first', { value: 6, writable: true, enumerable: true }); }")],
  ["accessor on the field that is left out", unseen("p => { Object.defineProperty(p, 'third', { get() { return [noteCall()]; }, set(v) { noteCall(); }, configurable: true, enumerable: true }); }")],
  ["a new name", unseen("p => { p.added = 1; }")],
  ["a new name in front by deletion", unseen("p => { const f = p.first; delete p.first; p.added = 1; p.first = f; }")],
  ["a new symbol", unseen("p => { p[Symbol.for('added')] = 1; }")],
  ["an element", unseen("p => { p[0] = 'zero'; }")],
  ["a hidden new name", unseen("p => { Object.defineProperty(p, 'added', { value: 1 }); }")],
  ["Error.captureStackTrace", unseen("p => { Error.captureStackTrace(p); Object.defineProperty(p, 'stack', { value: 'trace', enumerable: true }); }")],
];

const probes: [string, (pair: Pair, deed: Deed) => string][] = [
  ["between", between],
  ["stores between", storesBetween],
  ["in a loop", inLoop],
  ["below calls", belowCalls],
];

for (let turn = 0; turn < 50; turn++) {
  for (const [, probe] of probes) probe(new Pair(turn), () => {});
}

for (const [name, deed] of deeds) {
  for (const seed of [2, 3]) {
    for (const [where, probe] of probes) console.log(name + " | " + seed + " | " + where + ": " + probe(new Pair(seed), deed) + " calls " + calls);
  }
}

console.log(look(new Pair(4)), look(new Pair(5)));
