// The call of a generator function evaluates the parameters and stops. The body runs at the first step, whenever that comes and whoever takes it. The start may be put off to the first step
// where nobody can look in between: not at what the parameters did, not at the generator, not at what the body reads.
// How the generator begins x what happens before its first step x who takes that step, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const common = `let shared = 0;
function note(label: string, value: number): number { say(label); return value; }
const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
function* innerSteps(from: number): Generator<number, void> { say("inner"); yield from; yield from + 1; }
`;

/** `declares` a function `made`, and `call` makes a generator with it. */
type Head = { declares: string; call?: (turn: string) => string };
const heads: Record<string, Head> = {
  plain: { declares: `function* made(from: number): Generator<number, string> { yield from; yield from + 1; return "end"; }` },
  saysSomethingFirst: { declares: `function* made(from: number): Generator<number, string> { say("started", from); yield from; yield from + 1; return "end"; }` },
  hasADefaultThatSays: { declares: `function* made(from: number, more = note("default", 3)): Generator<number, string> { yield from + more; yield from; return "end"; }` },
  hasADefaultThatThrows: { declares: `function* made(from: number, more = (fail(from === 2), 1)): Generator<number, string> { yield from + more; return "end"; }` },
  takesAnObjectApart: { declares: `function* made({ from }: { from: number }): Generator<number, string> { yield from; yield from + 1; return "end"; }`, call: turn => `made({ get from() { say("read"); return ${turn}; } })` },
  throwsBeforeItYields: { declares: `function* made(from: number): Generator<number, string> { fail(from === 2); yield from; return "end"; }` },
  readsAVariableFirst: { declares: `function* made(from: number): Generator<number, string> { const now = shared; yield now + from; yield shared; return "end"; }` },
  writesAVariableFirst: { declares: `function* made(from: number): Generator<number, string> { shared += 100; yield from; return "end"; }` },
  countsWhatItWasGiven: { declares: `function* made(from: number, ...rest: number[]): Generator<number, string> { yield arguments.length + rest.length; yield from; return "end"; }`, call: turn => `made(${turn}, 1, 2)` },
  isAMethod: { declares: `const owner = { from: 5, *made(more: number): Generator<number, string> { yield this.from + more; this.from++; yield this.from; return "end"; } };`, call: turn => `owner.made(${turn})` },
  yieldsNothing: { declares: `function* made(from: number): Generator<number, string> { return "only " + from; }` },
  handsOnToAnother: { declares: `function* made(from: number): Generator<number, string> { yield* innerSteps(from); return "end"; }` },
  hasACleanup: { declares: `function* made(from: number): Generator<number, string> { try { yield from; yield from + 1; } finally { say("closed"); } return "end"; }` },
  hasACleanupAroundEverything: { declares: `function* made(from: number): Generator<number, string> { try { say("in"); yield from; } finally { say("closed"); } return "end"; }` },
  loops: { declares: `function* made(from: number): Generator<number, string> { for (let at = 0; at < 3; at++) yield from + at; return "end"; }` },
  takesWhatIsSent: { declares: `function* made(from: number): Generator<number, string, number> { const got = yield from; say("got", got); yield got + 1; return "end"; }` },
  holdsAVariableOfItsMaker: { declares: `function maker(from: number) { let held = from; return { steps: (function* (): Generator<number, string> { yield held; yield held + 1; return "end"; })(), bump() { held += 50; } }; }\nfunction made(from: number) { const both = maker(from); both.bump(); return both.steps; }` },
};

const betweens: Record<string, (turn: string) => string> = {
  nothing: () => ``,
  somethingIsSaid: () => `say("between");`,
  aVariableChanges: () => `shared += 10;`,
  itIsEnded: () => `say(steps.return("over" as never).value);`,
  anErrorIsThrownIntoIt: () => `try { steps.throw(new RangeError("in")); } catch { say("out"); }`,
  itIsKept: () => `kept.push(steps);`,
  itIsAskedForItsIterator: () => `say(steps[Symbol.iterator]() === steps);`,
  itIsGivenAName: () => `(steps as any).extra = 1;`,
  itIsGivenANextOfItsOwn: () => `(steps as any).next = () => ({ done: true, value: "own" });`,
  itIsPutBelowAnotherObject: () => `Object.setPrototypeOf(steps, { next: () => ({ done: true, value: "other" }), [Symbol.iterator]() { return this; } });`,
  itGoesThroughUnknownCode: () => `unknown(steps);`,
  unknownCodeTakesAStep: () => `say(unknown(steps).next().value);`,
  aThrow: turn => `fail(${turn} === 1);`,
  anotherIsMadeAndStepped: turn => `say(CALL(${turn} + 5).next().value);`,
  aLoop: () => `for (let at = 0; at < 2; at++) shared++;`,
};

const firstSteps: Record<string, (turn: string) => string> = {
  next: () => `say(steps.next().value);`,
  nextTwice: () => `say(steps.next().value, steps.next().value);`,
  nextWithAValue: () => `say(steps.next(5 as never).value, steps.next(6 as never).value);`,
  untilItIsDone: () => `for (let step = steps.next(); !step.done; step = steps.next()) say(step.value);`,
  nextInALoop: () => `for (let at = 0; at < 3; at++) say(steps.next().value);`,
  spread: () => `say(...steps);`,
  walked: () => `for (const each of steps) say(each);`,
  walkedAndLeftEarly: () => `for (const each of steps) { say(each); break; } say(steps.next().done);`,
  takenApart: () => `const [head, tail] = steps; say(head, tail);`,
  madeIntoAList: () => `say(Array.from(steps).length);`,
  onOneWay: turn => `if (${turn} % 2) say(steps.next().value); say(steps.next().value);`,
  underAHandler: () => `try { say(steps.next().value); } catch { say("caught"); } say(steps.next().done);`,
  byAClosure: () => `const take = () => steps.next().value; say(take(), take());`,
  never: () => `say(typeof steps);`,
  endedFirst: () => `say(steps.return("gone" as never).done, steps.next().done);`,
};

/** Behind these the generator is still held, so it stays a generator whatever walks it. */
const firstStepsOfOneThatIsKept: Record<string, (turn: string) => string> = {
  nextAndKept: () => `say(steps.next().value); kept.push(steps);`,
  nextInALoopAndKept: () => `let at = 0; do say(steps.next().value); while (++at < 3); kept.push(steps);`,
  nextInALoopOfSomeTurnsAndKept: turn => `let at = 0; do say(steps.next().value); while (++at < ${turn} % 4); kept.push(steps); say(steps.next().done);`,
  onBothWaysAndKept: turn => `if (${turn} % 2) say("odd", steps.next().value); else say("even", steps.next().value); kept.push(steps); say(steps.next().value);`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 500;

const fewPlaces = ["once", "often", "loop", "loopThatStartsAnew", "handler", "handlerInALoop", "cleanup", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "callsItself", "aroundAYield", "aroundAnAwait", "module", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const stretch = (head: string, between: string, firstStep: string): Stretch => {
    const call = heads[head].call ?? ((turn: string) => `made(${turn})`);
    return {
      name: `${head}-${between}-${firstStep}`,
      beside: common + heads[head].declares + "\n",
      before: seed => `const kept: unknown[] = []; shared = ${seed};`,
      body: turn => `const steps = ${call(turn)}; ${betweens[between](turn).replace(/CALL\(([^)]*)\)/, (_, given) => call(given))} ${(firstSteps[firstStep] ?? firstStepsOfOneThatIsKept[firstStep])(turn)}`,
      after: `shared + ":" + kept.length`,
    };
  };
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  let at = 0;
  for (const head in heads) for (const between in betweens) for (const firstStep in firstSteps) (at++ % 7 ? inFewPlaces : everywhere).push(stretch(head, between, firstStep));
  for (const head in heads) for (const between in betweens) for (const firstStep in firstStepsOfOneThatIsKept) (at++ % 7 ? inFewPlaces : everywhere).push(stretch(head, between, firstStep));
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
