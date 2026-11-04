// An object is frozen, sealed or closed between two stores of one function: by a callee, in a turn of a loop, by a getter, by a conversion of what is stored, through another name of the object, and in plain sight.
// The store in front goes through, the store behind is refused, and nothing that was learned in front of the change counts behind it.
class Point {
  x: number;
  y: number;
  label?: string;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
interface Pair {
  first: number;
  second: number;
  note?: string;
}
type Hook = (o: object) => void;

function describe(o: object) {
  return `${JSON.stringify(o)} frozen=${Object.isFrozen(o)} sealed=${Object.isSealed(o)} extensible=${Object.isExtensible(o)}`;
}
function say(what: string, run: () => unknown) {
  try {
    console.log(what, "->", String(run()));
  } catch (e: any) {
    console.log(what, "->", e.constructor.name + ": " + e.message);
  }
}

const hooks: [string, Hook][] = [
  ["nothing", () => {}],
  ["freeze", o => void Object.freeze(o)],
  ["seal", o => void Object.seal(o)],
  ["preventExtensions", o => void Object.preventExtensions(o)],
  ["x read only", o => void Object.defineProperty(o, "x", { writable: false })],
  ["y read only", o => void Object.defineProperty(o, "y", { writable: false })],
  ["y an accessor", o => void Object.defineProperty(o, "y", { get: () => -1, set() {}, configurable: true })],
  ["y deleted", o => void delete (o as any).y],
  ["y deleted, then closed", o => (delete (o as any).y, void Object.preventExtensions(o))],
];

function aroundCall(p: Point, hook: Hook) {
  p.x = 10;
  hook(p);
  p.y = 20;
  return p.x + p.y;
}
function sameFieldAroundCall(p: Point, hook: Hook) {
  p.x = 10;
  hook(p);
  p.x = 11;
  return p.x;
}
function addedAroundCall(p: Point, hook: Hook) {
  p.x = 10;
  hook(p);
  p.label = "late";
  return p.label;
}
function inLoop(p: Point, hook: Hook, at: number) {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    p.x = i;
    if (i === at) hook(p);
    p.y = i * 2;
    sum = sum * 3 + p.x + p.y;
  }
  return sum;
}
function inLoopCaught(p: Point, hook: Hook, at: number) {
  let refused = 0;
  for (let i = 0; i < 6; i++) {
    try {
      p.x = i;
      if (i === at) hook(p);
      p.y = i * 2;
    } catch {
      refused++;
    }
  }
  return `${refused} ${p.x} ${p.y}`;
}
function overList(list: Point[], hook: Hook, at: number) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.x = i + 1;
    if (i === at) hook(list[(i + 1) % list.length]);
    p.y = i + 2;
    sum = sum * 5 + p.x + p.y;
  }
  return sum;
}

class Trigger {
  target: object | undefined = undefined;
  hook: Hook = () => {};
  get value() {
    if (this.target) this.hook(this.target);
    return 5;
  }
  valueOf() {
    if (this.target) this.hook(this.target);
    return 6;
  }
  toString() {
    if (this.target) this.hook(this.target);
    return "seven";
  }
}
function aroundGetter(p: Point, trigger: Trigger) {
  p.x = 1;
  const v = trigger.value;
  p.y = v;
  return p.x + p.y;
}
function getterInTheStore(p: Point, trigger: Trigger) {
  p.x = 1;
  p.y = trigger.value;
  p.x = 2;
  return p.x + p.y;
}
function aroundConversion(p: Point, trigger: Trigger) {
  p.x = 1;
  p.y = +trigger;
  p.x = 2;
  return p.x + p.y;
}
function aroundText(p: Point, trigger: Trigger) {
  p.x = 1;
  p.label = `${trigger}`;
  p.x = 2;
  return p.x + p.label;
}
function aroundArithmetic(p: Point, trigger: any) {
  p.x = 1;
  p.y = trigger * 2;
  p.x = p.y + 1;
  return p.x;
}

function throughOtherName(p: Point, q: Point) {
  p.x = 1;
  Object.freeze(q);
  p.x = 2;
  return p.x;
}
function throughOtherNameOfPair(p: Pair, q: Pair) {
  p.first = 1;
  Object.seal(q);
  p.first = 2;
  p.note = "added";
  return p.first + p.note;
}
function throughHolder(p: Point, holder: { inner: Point }) {
  p.x = 1;
  Object.freeze(holder.inner);
  p.y = 2;
  return p.x + p.y;
}

function madeAndFrozen() {
  const p = new Point(1, 2);
  Object.freeze(p);
  p.x = 5;
  return p.x;
}
function literalMadeAndFrozen() {
  const o = { first: 1, second: 2 };
  Object.freeze(o);
  o.first = 3;
  return o.first;
}
function literalFrozenWhereItIsMade() {
  const o = Object.freeze({ first: 1, second: 2 }) as Pair;
  o.second = 3;
  return o.second;
}
function literalMadeAndSealed() {
  const o: Pair = { first: 1, second: 2 };
  Object.seal(o);
  o.first = 3;
  o.note = "n";
  return o.first;
}
function literalMadeAndClosed() {
  const o: Pair = { first: 1, second: 2 };
  Object.preventExtensions(o);
  o.second = 4;
  o.note = "n";
  return o.second;
}
function madeAndMaybeFrozen(freezes: boolean) {
  const p = new Point(1, 2);
  if (freezes) Object.freeze(p);
  p.x = 9;
  return p.x;
}
function madeAndFrozenInLoop(at: number) {
  const p = new Point(0, 0);
  for (let i = 0; i < 5; i++) {
    p.x = i;
    if (i === at) Object.freeze(p);
  }
  return p.x;
}
function madeStoredAndFrozen() {
  const p = new Point(1, 2);
  p.x = 3;
  p.label = "here";
  Object.freeze(p);
  p.y = 4;
  return p.y;
}
function madeAndReadOnly() {
  const p = new Point(1, 2);
  Object.defineProperty(p, "x", { writable: false });
  p.y = 3;
  p.x = 4;
  return p.x;
}
function frozenByReflect() {
  const p = new Point(1, 2);
  Reflect.preventExtensions(p);
  p.x = 3;
  p.label = "no";
  return p.x;
}
function frozenAndAsked() {
  const p = new Point(1, 2);
  const before = Object.isFrozen(p);
  Object.freeze(p);
  const after = Object.isFrozen(p);
  let refused = false;
  try {
    p.x = 3;
  } catch {
    refused = true;
  }
  return `${before} ${after} ${refused} ${p.x} ${Object.isFrozen(p)}`;
}

const idle = new Trigger();
for (let i = 0; i < 300; i++) {
  const p = new Point(i, i);
  aroundCall(p, hooks[0][1]);
  sameFieldAroundCall(p, hooks[0][1]);
  addedAroundCall(new Point(1, 2), hooks[0][1]);
  inLoop(p, hooks[0][1], 2);
  inLoopCaught(p, hooks[0][1], 2);
  overList([p, new Point(1, 2), new Point(3, 4)], hooks[0][1], 1);
  aroundGetter(p, idle);
  getterInTheStore(p, idle);
  aroundConversion(p, idle);
  aroundText(p, idle);
  aroundArithmetic(p, idle);
  madeAndMaybeFrozen(false);
  madeAndFrozenInLoop(9);
}

for (const [name, hook] of hooks) {
  let p!: Point;
  say(`${name}: aroundCall`, () => aroundCall((p = new Point(1, 2)), hook));
  console.log(" ", describe(p));
  say(`${name}: sameFieldAroundCall`, () => sameFieldAroundCall((p = new Point(1, 2)), hook));
  console.log(" ", describe(p));
  say(`${name}: addedAroundCall`, () => addedAroundCall((p = new Point(1, 2)), hook));
  console.log(" ", describe(p));
  for (const at of [0, 3, 5]) {
    say(`${name}: inLoop at ${at}`, () => inLoop((p = new Point(1, 2)), hook, at));
    console.log(" ", describe(p));
    say(`${name}: inLoopCaught at ${at}`, () => inLoopCaught((p = new Point(1, 2)), hook, at));
    console.log(" ", describe(p));
  }
  let list!: Point[];
  for (const at of [0, 2]) {
    say(`${name}: overList at ${at}`, () => overList((list = [new Point(1, 2), new Point(3, 4), new Point(5, 6)]), hook, at));
    console.log(" ", list.map(describe).join(" | "));
  }
  const trigger = new Trigger();
  trigger.hook = hook;
  for (const [title, run] of [
    ["aroundGetter", aroundGetter],
    ["getterInTheStore", getterInTheStore],
    ["aroundConversion", aroundConversion],
    ["aroundText", aroundText],
    ["aroundArithmetic", aroundArithmetic],
  ] as [string, (p: Point, t: Trigger) => unknown][]) {
    say(`${name}: ${title}`, () => run((trigger.target = p = new Point(1, 2)), trigger));
    console.log(" ", describe(p));
  }
}

{
  let p = new Point(1, 2);
  say("throughOtherName, another object", () => throughOtherName(p, new Point(3, 4)));
  console.log(" ", describe(p));
  say("throughOtherName, the same object", () => throughOtherName(p, p));
  console.log(" ", describe(p));
  let pair: Pair = { first: 1, second: 2 };
  say("throughOtherNameOfPair, another object", () => throughOtherNameOfPair(pair, { first: 3, second: 4 }));
  console.log(" ", describe(pair));
  pair = { first: 1, second: 2 };
  say("throughOtherNameOfPair, the same object", () => throughOtherNameOfPair(pair, pair));
  console.log(" ", describe(pair));
  p = new Point(1, 2);
  say("throughHolder, another object", () => throughHolder(p, { inner: new Point(3, 4) }));
  console.log(" ", describe(p));
  say("throughHolder, the same object", () => throughHolder(p, { inner: p }));
  console.log(" ", describe(p));
}

say("madeAndFrozen", madeAndFrozen);
say("literalMadeAndFrozen", literalMadeAndFrozen);
say("literalFrozenWhereItIsMade", literalFrozenWhereItIsMade);
say("literalMadeAndSealed", literalMadeAndSealed);
say("literalMadeAndClosed", literalMadeAndClosed);
say("madeAndMaybeFrozen(false)", () => madeAndMaybeFrozen(false));
say("madeAndMaybeFrozen(true)", () => madeAndMaybeFrozen(true));
say("madeAndFrozenInLoop(9)", () => madeAndFrozenInLoop(9));
say("madeAndFrozenInLoop(2)", () => madeAndFrozenInLoop(2));
say("madeAndFrozenInLoop(4)", () => madeAndFrozenInLoop(4));
say("madeStoredAndFrozen", madeStoredAndFrozen);
say("madeAndReadOnly", madeAndReadOnly);
say("frozenByReflect", frozenByReflect);
say("frozenAndAsked", frozenAndAsked);
