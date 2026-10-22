// A reader of numbers and booleans that every constructor stores tests the object once and then reads the raw values. undefined and null have room in such a slot,
// so whoever puts one there has to be seen by that one test: each way of doing so is tried below, on an object of its own, and every object goes through the same readers.
const out: string[] = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there.
const hide = new Function("value", "return value" + suffix) as <V>(value: V) => V;
const storeUnseen = new Function("object", "key", "value", "object[key] = value" + suffix) as (object: object, key: string, value: unknown) => void;
const storeUnderName = (key: string, head = "") => new Function("object", "value", head + "object." + key + " = value" + suffix) as (object: object, value: unknown) => void;
const defineUnseen = new Function("object", "key", "descriptor", "return Object.defineProperty(object, key, descriptor)" + suffix) as (object: object, key: string, descriptor: PropertyDescriptor) => void;
const removeUnseen = new Function("object", "key", "return delete object[key]" + suffix) as (object: object, key: string) => boolean;
const nothing = hide<unknown>(undefined);
const none = hide<unknown>(null);

class Counter {
  count: number;
  ratio: number;
  on: boolean;
  large: number;
  label: string;
  next: Counter | null;
  constructor(seed: number) {
    this.count = seed | 0;
    this.ratio = seed + 0.5;
    this.on = seed > 1;
    this.large = seed * 4294967296;
    this.label = "c" + seed;
    this.next = null;
  }
}

function read(counter: Counter): unknown[] {
  return [counter.count, typeof counter.count, counter.ratio, typeof counter.ratio, counter.on, typeof counter.on, counter.large, typeof counter.large, counter.label, Object.keys(counter).join()];
}
function compute(counter: Counter): unknown[] {
  return [counter.count | 0, counter.count + 1, counter.ratio * 2, counter.on ? "on" : "off", !counter.on, counter.large / 2, counter.count === 3, counter.count < 10, `${counter.count}|${counter.ratio}|${counter.on}`];
}
function change(counter: Counter): unknown[] {
  counter.count++;
  counter.ratio += 1;
  counter.on = !counter.on;
  counter.large -= 1;
  return [counter.count, counter.ratio, counter.on, counter.large];
}
function store(counter: Counter, count: number, ratio: number, on: boolean): unknown[] {
  counter.count = count;
  counter.ratio = ratio;
  counter.on = on;
  return [counter.count, counter.ratio, counter.on, Object.keys(counter).join()];
}
function readAcrossACall(counter: Counter, between: (counter: Counter) => void): unknown[] {
  const before = counter.count;
  const wasOn = counter.on;
  between(counter);
  return [before, counter.count, wasOn, counter.on, counter.ratio];
}
function show(name: string, value: unknown) {
  out.push(name + ": " + JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v)));
}
function tryAll(name: string, counter: Counter) {
  show(name + ", read", read(counter));
  show(name + ", computed with", compute(counter));
  show(name + ", changed", change(counter));
  show(name + ", read again", read(counter));
  show(name + ", stored", store(counter, 3, 1.25, true));
  show(name + ", read at last", read(counter));
  show(name + ", computed with at last", compute(counter));
}

tryAll("the first object", hide(new Counter(1)));
for (let i = 0; i < 40; i++) read(hide(new Counter(i)));
tryAll("a later object", hide(new Counter(2)));

const keys = ["count", "ratio", "on", "large"];
for (const [word, value] of [["undefined", undefined], ["null", null]] as const) {
  for (const key of keys) {
    const byUnseenCode = hide(new Counter(3));
    storeUnseen(byUnseenCode, key, value);
    tryAll(`${word} stored under ${key} by code that nobody sees`, byUnseenCode);

    const named = storeUnderName(key);
    for (let turn = 0; turn < 4; turn++) named(new Counter(turn), key === "on" ? false : turn);
    const byNameInUnseenCode = hide(new Counter(3));
    named(byNameInUnseenCode, value);
    tryAll(`${word} stored as .${key} by code that nobody sees`, byNameInUnseenCode);
    const byNameInStrictCode = hide(new Counter(3));
    storeUnderName(key, "'use strict'; ")(byNameInStrictCode, value);
    tryAll(`${word} stored as .${key} by strict code that nobody sees`, byNameInStrictCode);

    const byKey: any = hide(new Counter(4));
    byKey[key] = value;
    tryAll(`${word} stored under the computed key ${key}`, byKey);

    const assigned = hide(new Counter(5));
    Object.assign(assigned, { [key]: value });
    tryAll(`${word} assigned to ${key}`, assigned);

    const defined = hide(new Counter(6));
    Object.defineProperty(defined, key, { value, writable: true, enumerable: true, configurable: true });
    tryAll(`${word} defined as ${key}`, defined);

    const definedUnseen = hide(new Counter(7));
    defineUnseen(definedUnseen, key, { value, writable: true, enumerable: true, configurable: true });
    tryAll(`${word} defined as ${key} by code that nobody sees`, definedUnseen);

    const reflected = hide(new Counter(8));
    Reflect.set(reflected, key, value);
    tryAll(`${word} set by Reflect under ${key}`, reflected);
  }

  const byName: any = hide(new Counter(9));
  byName.count = value;
  byName.ratio = value;
  byName.on = value;
  byName.large = value;
  tryAll(`${word} stored by name through any`, byName);

  const literal = hide(new Counter(10));
  Object.assign(literal, { count: value, ratio: value, on: value, large: value });
  tryAll(`${word} assigned to all four`, literal);
  const again = hide(new Counter(11));
  Object.assign(again, { count: value, ratio: value, on: value, large: value });
  tryAll(`${word} assigned to all four a second time`, again);

  const source = hide(new Counter(12));
  storeUnseen(source, "count", value);
  storeUnseen(source, "on", value);
  const copy = hide(new Counter(13));
  Object.assign(copy, source);
  tryAll(`${word} copied from another object of the class`, copy);
  show(`${word} in a spread of such an object`, { ...source });
}

function storeWhatTheTypeHides(counter: Counter, count: unknown, ratio: unknown, on: unknown): unknown[] {
  counter.count = count as number;
  counter.ratio = ratio as number;
  counter.on = on as boolean;
  return [counter.count, counter.ratio, counter.on];
}
for (const [word, value] of [["undefined", nothing], ["null", none]] as const) {
  const typed = hide(new Counter(14));
  show(`${word} behind a cast`, storeWhatTheTypeHides(typed, value, value, value));
  tryAll(`${word} stored behind a cast`, typed);
  const partly = hide(new Counter(15));
  show(`${word} and numbers behind a cast`, storeWhatTheTypeHides(partly, 7, value, false));
  tryAll(`${word} stored behind a cast beside numbers`, partly);
}

for (const key of keys) {
  const deleted: any = hide(new Counter(16));
  delete deleted[key];
  tryAll(`${key} deleted`, deleted);
  const removed = hide(new Counter(17));
  removeUnseen(removed, key);
  tryAll(`${key} deleted by code that nobody sees`, removed);
  const other = hide(new Counter(18));
  storeUnseen(other, key, "text");
  tryAll(`a string under ${key}`, other);
  const accessor = hide(new Counter(19));
  let held: unknown = undefined;
  Object.defineProperty(accessor, key, { get() { return held; }, set(v) { held = v; }, enumerable: true, configurable: true });
  tryAll(`${key} an accessor that answers undefined`, accessor);
}

show("undefined arrives in the middle of a reader", readAcrossACall(hide(new Counter(20)), counter => { storeUnseen(counter, "count", undefined); storeUnseen(counter, "on", null); }));
show("undefined arrives by name in the middle of a reader", readAcrossACall(hide(new Counter(21)), counter => { (counter as any).count = nothing; (counter as any).on = none; (counter as any).ratio = nothing; }));
show("nothing arrives in the middle of a reader", readAcrossACall(hide(new Counter(22)), () => {}));

function neverLeaves(value: unknown): unknown[] {
  const local = new Counter(23);
  const before = local.count;
  (local as any).count = value;
  (local as any).on = value;
  return [before, local.count, typeof local.count, local.on, local.ratio];
}
show("an object that never leaves its function gets undefined", neverLeaves(nothing));
show("an object that never leaves its function gets null", neverLeaves(none));
show("an object that never leaves its function gets a number", neverLeaves(5));

// The definition of a class field stores undefined, and a constructor need not store anything behind it.
class Declared {
  count!: number;
  on!: boolean;
  ratio!: number;
  label: string;
  constructor(fill: boolean) {
    this.label = "d";
    if (fill) {
      this.count = 1;
      this.on = true;
      this.ratio = 0.5;
    }
  }
}
function readDeclared(declared: Declared): unknown[] {
  return [declared.count, typeof declared.count, declared.on, typeof declared.on, declared.ratio, typeof declared.ratio, declared.label, Object.keys(declared).join()];
}
show("every declared field stored", readDeclared(hide(new Declared(true))));
show("the declared fields left as they were defined", readDeclared(hide(new Declared(false))));
for (let i = 0; i < 20; i++) readDeclared(hide(new Declared(i % 2 === 0)));
show("every declared field stored, later", readDeclared(hide(new Declared(true))));
show("the declared fields left as they were defined, later", readDeclared(hide(new Declared(false))));

class FilledBehindDefinitions {
  count: number;
  on: boolean;
  ratio: number;
  constructor(seed: number) {
    this.count = seed;
    this.on = seed > 0;
    this.ratio = seed / 2;
  }
}
function readFilled(filled: FilledBehindDefinitions): unknown[] {
  return [filled.count, filled.on, filled.ratio, typeof filled.count, Object.keys(filled).join()];
}
show("definitions and then stores", readFilled(hide(new FilledBehindDefinitions(3))));
show("definitions and then a store of what the type hides", readFilled(hide(new FilledBehindDefinitions(nothing as number))));
show("for another new.target", readFilled(hide(Reflect.construct(FilledBehindDefinitions, [4], class Other {}))));

let seenEarly: unknown[] = [];
class SeenEarly {
  count: number;
  on: boolean;
  constructor(seed: number) {
    seenEarly = readSeenEarly(hide(this));
    this.count = seed;
    seenEarly.push(...readSeenEarly(hide(this)));
    this.on = true;
  }
}
function readSeenEarly(object: SeenEarly): unknown[] {
  return [object.count, typeof object.count, object.on, typeof object.on];
}
const early = hide(new SeenEarly(6));
show("seen before it was finished", seenEarly);
show("and after", readSeenEarly(early));

console.log(out.join("\n"));
