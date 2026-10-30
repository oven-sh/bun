// A loop that only counts, and whose turns leave nothing behind, may go. What a turn asks may still run code, throw, or never stop being asked; what the loop has counted may still be read.
// How the loop counts x how far x what a turn does, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `const counted = { get size(): number { say("size"); return 3; } };
const talker = { valueOf(): number { say("valueOf"); return 3; }, toString(): string { say("toString"); return "t"; } };
function limit(): number { say("limit"); return 3; }
function twice(value: number): number { return value * 2; }
function tells(value: number): number { say("told", value); return value; }
const proxied: Record<number, number> = new Proxy([1, 2, 3], { get(target, key) { say("get", String(key)); return Reflect.get(target, key); }, has(target, key) { say("has", String(key)); return Reflect.has(target, key); } });
const nothing: { [at: number]: number } | null = null;
const judge = { [Symbol.hasInstance](value: unknown): boolean { say("judged"); return false; } };
`;

/** `B` is the bound and `T` what a turn does. */
const counters: Record<string, string> = {
  up: `for (let at = 0; at < B; at++) { T }`,
  upToAndWith: `for (let at = 0; at <= B; at++) { T }`,
  down: `for (let at = B; at > 0; at--) { T }`,
  byTwo: `for (let at = 0; at < B; at += 2) { T }`,
  untilEqual: `for (let at = 0; at !== Math.max(0, Math.floor(+B || 0)); at++) { T }`,
  readBehindTheLoop: `let at = 0; for (; at < B; at++) { T } say(at);`,
  declaredWithVar: `for (var at = 0; at < B; at++) { T } say(at);`,
  whileLoop: `let at = 0; while (at < B) { T at++; }`,
  doLoop: `let at = 0; do { T } while (++at < B);`,
  byHalves: `for (let at = 0; at < B; at += 0.5) { T }`,
  heldByAClosure: `for (let at = 0; at < B; at++) { T readers.push(() => at); }`,
};

const bounds: Record<string, (turn: string) => string> = {
  four: () => `4`,
  theTurn: turn => `(${turn})`,
  theLengthOfAList: () => `list.length`,
  aField: () => `box.size`,
  aGetter: () => `counted.size`,
  aCall: () => `limit()`,
  anObject: () => `(talker as unknown as number)`,
  theLengthOfAText: () => `text.length`,
  notANumber: () => `NaN`,
  belowZero: () => `-1`,
  aFraction: () => `2.5`,
  aVariableOfTheModule: () => `far`,
};

const turns: Record<string, string> = {
  nothing: ``,
  computes: `const doubled = at * 2;`,
  addsUp: `total += at;`,
  readsAList: `list[at];`,
  readsPastTheEnd: `list[at + 2];`,
  readsAField: `box.size;`,
  readsAGetter: `counted.size;`,
  readsThroughAProxy: `proxied[at];`,
  readsFromNull: `nothing![at];`,
  readsAheadOfTheDeclaration: `if (at === 2) late;`,
  makesAnObject: `({ at });`,
  makesAList: `[at, at];`,
  makesAClosure: `() => at;`,
  callsWhatOnlyComputes: `twice(at);`,
  callsWhatTells: `tells(at);`,
  joinsTexts: `"a" + at;`,
  joinsAnObject: `"a" + talker;`,
  comparesWithAnObject: `at < (talker as unknown as number);`,
  asksAList: `at in list;`,
  asksAProxy: `at in proxied;`,
  asksAJudge: `box instanceof (judge as never);`,
  holdsALoop: `for (let inner = 0; inner < at; inner++) {}`,
  holdsALoopThatTells: `for (let inner = 0; inner < at; inner++) tells(inner);`,
  skipsATurn: `if (at === 1) continue;`,
  leavesEarly: `if (at === 2) break;`,
  hasAHandler: `try { twice(at); } catch {}`,
  throwsOnTheThirdTurn: `fail(at === 2);`,
  takesARoot: `Math.sqrt(at);`,
  dividesBigNumbers: `1n / BigInt(Math.floor(at));`,
  makesAListOfALength: `new Array(at - 1);`,
  repeatsAText: `"x".repeat(at - 1);`,
  writesANumberOut: `at.toString(at);`,
  makesBytes: `new Uint8Array(at - 1);`,
  joinsASymbol: `if (at === 2) "" + (Symbol() as unknown as string);`,
  readsACharacter: `text[at];`,
  readsACharacterCode: `text.charCodeAt(at);`,
  writesALocalObject: `const own = { at: 0 }; own.at = at;`,
  writesAListOfItsOwn: `const own = [0]; own[0] = at; own.push(at);`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 400;

const fewPlaces = ["once", "often", "loop", "twoLoops", "loopWithContinue", "handler", "handlerInALoop", "loopUnderAHandler", "cleanup", "copiedIntoALoop", "inAClosure", "aroundAYield", "aroundAnAwait", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  let nth = 0;
  for (const counter in counters)
    for (const bound in bounds)
      for (const turnName in turns) {
        if (counter === "doLoop" && turnName === "skipsATurn") continue;
        if (counter === "whileLoop" && turnName === "skipsATurn") continue;
        (nth++ % 9 ? inFewPlaces : everywhere).push({
          name: `${counter}-${bound}-${turnName}`,
          beside: beside + "let far = 3;\n",
          before: seed => `const list = [${seed}, 5, 6]; const box = { size: 3 }; const text = "abc"; let total = 0; const readers: (() => number)[] = [];`,
          body: turn => `${counters[counter].replaceAll("B", () => bounds[bound](turn)).replace("T", () => turns[turnName])} ${turnName === "readsAheadOfTheDeclaration" ? "let late = 1; say(late);" : ""}`,
          after: `total + ":" + readers.map(each => each()).join("")`,
        });
      }
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
