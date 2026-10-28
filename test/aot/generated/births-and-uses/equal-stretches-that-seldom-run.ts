// Code that seldom runs and stands in several functions in the same words may be kept once, as a function that all of them call. Each of them still sees its own variables, its own `this`
// and what it was given; an error still names the line where the program made it; two names of one object are still one object; and what is tested of an object ahead of the stretch is
// looked at again behind it if the stretch may have changed it.
// What the stretch does x what it is given x how it is reached, in three functions each, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const common = `class Box { value: number; more: number; constructor(value: number, more: number) { this.value = value; this.more = more; } }
const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
const log: unknown[] = [];
function lineOf(error: unknown): string { const found = /program\\.[a-z]+:(\\d+)/.exec(String((error as Error).stack)); return found ? "line " + found[1] : "no line"; }
`;

/** Statements over `box`, `again` (which may be the same object), `by` and `name`. What they find goes into `log`. */
const stretches: Record<string, string> = {
  throwsAnError: `throw new RangeError("bad " + name + " " + by + " " + box.value);`,
  makesAnErrorAndKeepsItsLine: `log.push(lineOf(new Error("here")));`,
  writesTheObject: `box.value = by + 100; box.more = box.value + 1; log.push(name, box.value);`,
  writesUnderTheOtherName: `again.value = by + 100; log.push(name, box.value, again.value);`,
  readsWritesReads: `const before = box.value; again.value = before + 1; log.push(name, before, box.value);`,
  addsAName: `(box as any).extra = by; (box as any).other = name; log.push(Object.keys(box).join(""));`,
  removesAName: `delete (box as any).more; log.push(name, Object.keys(box).join(""));`,
  storesByAKey: `(box as any)[name] = by; (box as any)[name + "2"] = by + 1; log.push(Object.keys(box).length);`,
  makesAnAccessor: `Object.defineProperty(box, "value", { get() { return by + 7; }, configurable: true }); log.push(name, box.value);`,
  makesAndKeepsAnObject: `const made = { name, by, box }; log.push(made.name, made.by, made.box === box);`,
  makesAnObjectAndComparesIt: `const made = new Box(by, 1); log.push(name, made === box, made === again, box === again);`,
  callsUnknownCode: `unknown(box).value += 2; unknown(name); log.push(name, box.value);`,
  buildsAText: `log.push("<" + name + ":" + by + ":" + box.value + ":" + box.more + ":" + typeof again + ">");`,
  callsAMethodByName: `log.push(String((box as any)[name]?.call(box)), [by, by + 1].map(String).join(name));`,
  walksTheObject: `for (const key in box) log.push(key + (box as any)[key]);`,
};

/** `S` is the stretch. Each declares a function of `(box, again, by)`, under the name `N`. */
const holders: Record<string, string> = {
  onARareWay: `function N(box: Box, again: Box, by: number): number { const name = "N"; if (by > 8) { S } return box.value + box.more; }`,
  inAHandler: `function N(box: Box, again: Box, by: number): number { const name = "N"; try { fail(by > 8); } catch { S } return box.value + box.more; }`,
  betweenTwoReads: `function N(box: Box, again: Box, by: number): number { const name = "N"; const first = box.value; if (by > 8) { S } return first + box.value + box.more; }`,
  inALoop: `function N(box: Box, again: Box, by: number): number { const name = "N"; let sum = 0; for (let at = 0; at < 3; at++) { sum += box.value; if (by > 8 && at === 1) { S } } return sum + box.more; }`,
  inAMethod: `class OfN { name = "N"; run(box: Box, again: Box, by: number): number { const name = this.name; if (by > 8) { S } return box.value + box.more; } }\nconst ofN = new OfN();\nfunction N(box: Box, again: Box, by: number): number { return ofN.run(box, again, by); }`,
  inAGenerator: `function* stepsOfN(box: Box, again: Box, by: number): Generator<number, number> { const name = "N"; yield box.value; if (by > 8) { S } return box.value + box.more; }\nfunction N(box: Box, again: Box, by: number): number { const steps = stepsOfN(box, again, by); steps.next(); return steps.next().value; }`,
  inAClosure: `function N(box: Box, again: Box, by: number): number { const name = "N"; const rarely = () => { S }; if (by > 8) rarely(); return box.value + box.more; }`,
  withAnObjectOfItsOwn: `function N(given: Box, other: Box, by: number): number { const name = "N"; const box = new Box(given.value, by); const again = by % 2 ? box : other; if (by > 8) { S } return box.value + box.more; }`,
};

const gifts: Record<string, string> = {
  twoObjects: `new Box(now, 1), new Box(now + 1, 2)`,
  oneObjectTwice: `shared, shared`,
  aChildOfTheClass: `new (class extends Box { extra = 5; })(now, 1), shared`,
  aLiteral: `{ value: now, more: 1 }, shared`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 150;

const fewPlaces = ["once", "often", "loop", "handler", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "loopWithAYield", "loopWithAnAwait", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const stretch in stretches)
    for (const holder in holders)
      for (const gift in gifts)
        all.push({
          name: `${stretch}-${holder}-${gift}`,
          beside: common + ["alpha", "beta", "gamma"].map(name => holders[holder].replaceAll("S", () => stretches[stretch]).replaceAll("N", name)).join("\n") + "\n",
          before: seed => `let sum = ${seed}; const shared = new Box(${seed}, 3);`,
          body: () => `for (const each of [alpha, beta, gamma]) { for (let at = 0; at < 3; at++) sum += each(new Box(at, 1), shared, at); try { sum += each(${gifts[gift]}, now + 9); } catch (error) { say((error as Error).message, lineOf(error)); } } say(log.join()); log.length = 0;`,
          after: `sum + ":" + shared.value + ":" + shared.more`,
        });
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped, fewPlaces), isTyped);
}
