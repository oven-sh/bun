// A parameter that the body never reads need not be passed, and a result that no caller reads need not be made. What stands in the call is still evaluated, in its order; a default, a pattern
// or a rest parameter still does its work; `arguments`, `length` and a caller that the compiler does not see still find the function as it was written.
// How the parameter is declared x what is passed for it x how the function is called, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const common = `function note(label: string, value: number): number { say(label); return value; }
const talker = { get inner(): number { say("inner read"); return 4; }, valueOf(): number { say("valueOf"); return 5; } };
const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
let calls = 0;
`;

/** Declares `taker`. Its first parameter is read, the second is not. */
const declarations: Record<string, string> = {
  plain: `function taker(used: number, unused?: unknown): number { calls++; return used + 1; }`,
  withADefaultThatSays: `function taker(used: number, unused: unknown = note("default", 1)): number { calls++; return used + 1; }`,
  withADefaultThatReadsTheFirst: `function taker(used: number, unused: unknown = (used += 10)): number { calls++; return used + 1; }`,
  takenApart: `function taker(used: number, { inner }: { inner?: number } = {}): number { calls++; return used + 1; }`,
  takenApartAsAList: `function taker(used: number, [head]: Iterable<unknown> = []): number { calls++; return used + 1; }`,
  rest: `function taker(used: number, ...unused: unknown[]): number { calls++; return used + 1; }`,
  seenThroughArguments: `function taker(used: number, unused?: unknown): number { calls++; return used + arguments.length; }`,
  readThroughArguments: `function taker(used: number, unused?: unknown): number { calls++; return used + (typeof arguments[1]).length; }`,
  writtenOnly: `function taker(used: number, unused?: unknown): number { calls++; unused = used; return used + 1; }`,
  handedOnToOneThatIgnoresIt: `function innermost(used: number, unused?: unknown): number { return used + 1; }\nfunction taker(used: number, unused?: unknown): number { calls++; return innermost(used, unused); }`,
  handedOnToItself: `function taker(used: number, unused?: unknown, depth = 0): number { calls++; return depth < 2 ? taker(used + 1, unused, depth + 1) : used; }`,
  heldByAClosureNobodyCalls: `function taker(used: number, unused?: unknown): number { calls++; const never = () => unused; return used + never.length + 1; }`,
  readOnAWayNeverTaken: `function taker(used: number, unused?: unknown): number { calls++; if (used < -1000) return Number(unused); return used + 1; }`,
  arrow: `const taker = (used: number, unused?: unknown): number => { calls++; return used + 1; };`,
  method: `const owner = { base: 1, taker(used: number, unused?: unknown): number { calls++; return used + this.base; } };\nconst taker = (used: number, unused?: unknown): number => owner.taker(used, unused);`,
  constructorOfAClass: `class Taken { sum: number; constructor(used: number, unused?: unknown) { calls++; this.sum = used + 1; } }\nconst taker = (used: number, unused?: unknown): number => new Taken(used, unused).sum;`,
  generator: `function* steps(used: number, unused?: unknown): Generator<number> { calls++; yield used + 1; }\nconst taker = (used: number, unused?: unknown): number => steps(used, unused).next().value;`,
  answersTwoThings: `function both(used: number, unused?: unknown): [number, number] { calls++; return [used + 1, note("second", 2)]; }\nconst taker = (used: number, unused?: unknown): number => both(used, unused)[0];`,
  answersAnObjectReadInPart: `function both(used: number, unused?: unknown): { sum: number; more: number } { calls++; return { sum: used + 1, more: note("more", 2) }; }\nconst taker = (used: number, unused?: unknown): number => both(used, unused).sum;`,
  thisIsNotRead: `function loose(this: unknown, used: number, unused?: unknown): number { calls++; return used + 1; }\nconst taker = (used: number, unused?: unknown): number => loose.call(note("this", 0), used, unused);`,
};

const given: Record<string, (turn: string) => string> = {
  nothing: () => ``,
  aNumber: turn => `, ${turn}`,
  aCallThatSays: () => `, note("given", 2)`,
  aCallThatThrows: turn => `, fail(${turn} === 2)`,
  aWrite: () => `, (base += 5)`,
  aNewObject: turn => `, { inner: ${turn} }`,
  anObjectWithAGetter: () => `, talker`,
  aNewList: turn => `, [${turn}]`,
  undefined: () => `, undefined`,
  null: () => `, null`,
  aGetterRead: () => `, talker.inner`,
  aClosure: () => `, () => base`,
  twoThings: () => `, note("second", 2), note("third", 3)`,
  aSpread: turn => `, ...[note("spread", 1), ${turn}]`,
};

/** `A` are the arguments behind the first. */
const callers: Record<string, string> = {
  called: `say(taker(note("first", base)A));`,
  resultDropped: `taker(note("first", base)A);`,
  resultReadOnOneWay: `const got = taker(baseA); if (base % 2) say(got);`,
  byCall: `say((taker as Function).call(null, baseA));`,
  byApply: `say((taker as Function).apply(null, [baseA]));`,
  bound: `say((taker as Function).bind(null, base)(...[0A].slice(1)));`,
  throughUnknownCode: `say(unknown(taker)(baseA));`,
  asACallback: `say([base].map(each => taker(eachA)).join());`,
  asTheCallbackItself: `say([base, base + 1].map(taker as never).join());`,
  asked: `say(taker.length, taker(baseA));`,
  inALoop: `for (let at = 0; at < 2; at++) say(taker(base + atA));`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 500;

const fewPlaces = ["once", "often", "loop", "handler", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "callsItself", "aroundAYield", "aroundAnAwait", "module"];

export function programs(isTyped?: boolean) {
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  let nth = 0;
  for (const declaration in declarations)
    for (const gift in given)
      for (const caller in callers)
        (nth++ % 10 ? inFewPlaces : everywhere).push({
          name: `${declaration}-${gift}-${caller}`,
          beside: common + declarations[declaration] + "\n",
          before: seed => `let base = ${seed};`,
          body: turn => callers[caller].replaceAll("A", () => given[gift](turn) + (isTyped && /takenApart/.test(declaration) && gift !== "nothing" ? " as never" : "")),
          after: `base + ":" + calls`,
        });
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
