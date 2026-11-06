// A function that is written for one kind of object finds out somewhere in its body that it was given another. It may then begin again in a slower form of itself only if nothing that it did
// so far can be told: whatever it counted, wrote, said or called is done once.
// What the function does first x where it first looks at the object x what the object is instead, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const common = `class Box { value: number; more: number; constructor(value: number, more: number) { this.value = value; this.more = more; } }
class Child extends Box { extra = 1; }
let count = 0;
const log: unknown[] = [];
const other = new Box(0, 0);
const holder = { get now(): number { say("now"); return 1; } };
const talker = { toString(): string { say("toString"); return "t"; } };
const table: Record<string, () => void> = { nothing() {} };
function unknown(): void { table["no" + "thing"](); }
function* forever(): Generator<number, never> { for (let at = 0; ; at++) yield at; }
const steps = forever();
let bumped = 0;
const bump = () => ++bumped;
const seenBoxes = new Set<unknown>();
`;

const effects: Record<string, string> = {
  nothing: ``,
  countsUp: `count++;`,
  writesALog: `log.push(by);`,
  saysSomething: `say("in", by);`,
  writesTheObject: `box.more += 1;`,
  writesAnotherObject: `other.value++;`,
  readsAGetter: `holder.now;`,
  callsUnknownCode: `unknown();`,
  turnsAnObjectIntoText: `String(talker);`,
  joinsAnObject: `"" + talker;`,
  takesAStep: `steps.next();`,
  writesItsParameter: `by += 1;`,
  writesAVariableOfAClosure: `bump();`,
  addsToASet: `seenBoxes.add(by);`,
  mayThrow: `fail(by === 12);`,
  makesAnObjectAndKeepsIt: `log.push({ by }.by);`,
  countsInALoop: `for (let at = 0; at < 2; at++) count++;`,
  countsOnOneWay: `if (by % 2) count++;`,
};

/** `E` is what is done first. */
const bodies: Record<string, string> = {
  looksBehindIt: `function work(box: Box, by: number): number { E return box.value * by + box.more; }`,
  looksAroundIt: `function work(box: Box, by: number): number { const first = box.value; E return first * by + box.more; }`,
  looksAtAnotherObjectFirst: `function work(box: Box, by: number): number { const first = other.more; E return first * by + box.value + box.more; }`,
  looksInALoop: `function work(box: Box, by: number): number { let sum = 0; for (let at = 0; at < 2; at++) { E sum += box.value * by; } return sum + box.more; }`,
  looksOnOneWay: `function work(box: Box, by: number): number { E if (by % 2) return box.value; return box.more + by; }`,
  looksUnderAHandler: `function work(box: Box, by: number): number { try { E return box.value * by + box.more; } catch { return -1; } }`,
  isAMethod: `class Worker { scale = 2; work(box: Box, by: number): number { E return box.value * by * this.scale + box.more; } }\nconst worker = new Worker();\nfunction work(box: Box, by: number): number { return worker.work(box, by); }`,
  handsItOn: `function reads(box: Box): number { return box.value + box.more; }\nfunction work(box: Box, by: number): number { E return reads(box) * by; }`,
};

const strangers: Record<string, (turn: string) => string> = {
  aLiteral: turn => `{ value: ${turn}, more: 1 }`,
  aLiteralInAnotherOrder: turn => `{ more: 1, value: ${turn} }`,
  withAnAccessor: turn => `Object.defineProperty(new Box(0, 1), "value", { get() { say("get"); return ${turn}; } })`,
  withAnAccessorForTheSecondField: turn => `Object.defineProperty(new Box(${turn}, 1), "more", { get() { say("get more"); return 2; }, set() { say("set more"); } })`,
  frozen: turn => `Object.freeze(new Box(${turn}, 1))`,
  aChild: turn => `new Child(${turn}, 1)`,
  withMoreNames: turn => `Object.assign(new Box(${turn}, 1), { extra: 1 })`,
  withoutAField: turn => `((box: Box) => { delete (box as Partial<Box>).more; return box; })(new Box(${turn}, 1))`,
  belowAnotherObject: turn => `Object.setPrototypeOf(new Box(${turn}, 1), { other: true })`,
  createdBelowThePrototype: turn => `Object.create(Box.prototype, { value: { value: ${turn}, writable: true }, more: { value: 1, writable: true } })`,
  aProxy: turn => `new Proxy(new Box(${turn}, 1), { get(target, key) { say("trap", String(key)); return Reflect.get(target, key); } })`,
  null: () => `null`,
  undefined: () => `undefined`,
  aNumber: turn => `${turn}`,
  withVeryManyNames: turn => `((box: any) => { for (let at = 0; at < 70; at++) box["n" + at] = at; return box; })(new Box(${turn}, 1))`,
  withFractions: turn => `new Box(${turn} + 0.5, 1.5)`,
  withTexts: turn => `new Box("v" + ${turn} as never, "m" as never)`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 500;

const fewPlaces = ["once", "often", "loop", "loopOften", "handler", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "loopWithAYield", "loopWithAnAwait", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  let nth = 0;
  for (const effect in effects)
    for (const body in bodies)
      for (const stranger in strangers)
        (nth++ % 11 ? inFewPlaces : everywhere).push({
          name: `${effect}-${body}-${stranger}`,
          beside: common + bodies[body].replace("E", () => effects[effect]) + "\n",
          before: seed => `let sum = ${seed};`,
          body: turn => `for (let at = 0; at < 3; at++) sum += work(new Box(at, 1), ${turn}); say(work((${strangers[stranger](turn)}) as unknown as Box, ${turn} + 10));`,
          after: `sum + ":" + count + ":" + log.length + ":" + other.value + ":" + bumped + ":" + seenBoxes.size + ":" + steps.next().value`,
        });
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
