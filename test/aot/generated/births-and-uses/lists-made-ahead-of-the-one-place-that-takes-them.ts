// A list that one operation alone takes may be made right in front of that operation. It is still one list however often the operation runs, it still holds what its members were when the
// text made it, and a function's own `arguments` still hold what the caller gave.
// What is made x what happens between the making and the taking x who takes it, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `function next(): number { return ++handedOut; }
let handedOut = 0;
const table: Record<string, () => void> = { nothing() {} };
function unknown(): void { table["no" + "thing"](); }
function count(...all: unknown[]): string { return all.length + ":" + String(all[0]); }
function grows(list: unknown[]): unknown[] { list.push("grown"); return list; }
function shown(kept: unknown[]): string {
  let text = JSON.stringify(kept, (_, value) => (typeof value === "function" ? "f" + value() : value instanceof Set ? [...value] : value)) ?? "";
  for (let at = 1; at < kept.length; at++) text += typeof kept[at] === "object" && kept[at] === kept[at - 1] ? "=" : "!";
  return text;
}
function allGiven(first: number, second: number): unknown { const all = arguments; first = 90; second += 5; unknown(); return count(...all) + first + second; }
function allGivenOnOneWay(first: number, second: number): unknown { const all = arguments; first = 90; if (second % 2) return Array.from(all).join("+"); return first; }
function allGivenInALoop(first: number, second: number): unknown { const all = arguments; const seen: unknown[] = []; for (let at = 0; at < 2; at++) { first++; seen.push(all); } return (seen[0] === seen[1]) + ":" + all[0] + ":" + all.length; }
`;

const makers: Record<string, (turn: string) => string> = {
  pair: turn => `[base, ${turn}]`,
  nested: turn => `[[base], [${turn}, [base + 1]]]`,
  ofAField: turn => `[box.value, ${turn}]`,
  ofCalls: () => `[next(), next()]`,
  empty: () => `[]`,
  withAHole: turn => `[base, , ${turn}]`,
  ofTexts: turn => `["a" + base, "b" + ${turn}]`,
  ofFractions: turn => `[base + 0.5, ${turn}]`,
  ofObjects: turn => `[{ at: ${turn} }, { at: base }]`,
  ofASpread: turn => `[...other, ${turn}]`,
  ofClosures: turn => `[() => base, () => ${turn}]`,
  ofAListOfTheSameKind: turn => `[[base, ${turn}], other]`,
};

const betweens: Record<string, (turn: string) => string> = {
  nothing: () => ``,
  whatItWasMadeFromChanges: () => `base += 10; box.value += 10; other.push(7);`,
  unknownCode: () => `unknown();`,
  aThrow: turn => `fail(${turn} === 2);`,
  aLoop: () => `for (let at = 0; at < 3; at++) base += at;`,
  aBranch: turn => `if (${turn} % 2) base++;`,
  anotherList: () => `kept.push([base]);`,
};

const takers: Record<string, (turn: string) => string> = {
  isKept: () => `kept.push(list);`,
  isKeptInALoop: () => `for (let at = 0; at < 2; at++) kept.push(list);`,
  isKeptInAWhileLoop: () => `let left = 2; while (left--) kept.push(list);`,
  isKeptOnOneWay: turn => `if (${turn} % 2) kept.push(list);`,
  isKeptOnARareWay: turn => `if (${turn} === 3) kept.push(list);`,
  isKeptInAHandler: () => `try { fail(true); } catch { kept.push(list); }`,
  isKeptInACleanup: () => `try { unknown(); } finally { kept.push(list); }`,
  isSpreadIntoACall: () => `kept.push(count(...list));`,
  isApplied: () => `kept.push(count.apply(null, list));`,
  isAnsweredByAClosure: () => `kept.push((() => list)());`,
  isAnsweredByAClosureTwice: () => `const again = () => list; kept.push(again() === again());`,
  goesIntoAnObject: () => `kept.push({ list });`,
  goesIntoASet: () => `kept.push(new Set(list));`,
  isChangedByWhoTakesIt: () => `kept.push(grows(list));`,
  isChangedInALoop: () => `for (let at = 0; at < 2; at++) grows(list).length > 4 && kept.push("long");`,
  isWalked: () => `for (const each of list) kept.push(typeof each);`,
  isTakenApart: () => `const [head, tail] = list; kept.push(typeof head, typeof tail);`,
};

const stretch = (maker: string, between: string, taker: string): Stretch => ({
  name: `${maker}-${between}-${taker}`,
  beside,
  before: seed => `const kept: unknown[] = []; let base = ${seed}; const box = { value: ${seed} }; const other: unknown[] = [${seed}, 4];`,
  body: turn => `const list: unknown[] = ${makers[maker](turn)}; ${betweens[between](turn)} ${takers[taker](turn)}`,
  after: "shown(kept) + base",
});

const ofArguments: Stretch[] = ["allGiven", "allGivenOnOneWay", "allGivenInALoop"].map(name => ({ name, beside, before: seed => `let base = ${seed};`, body: turn => `say(${name}(base, ${turn})); base++;`, after: "base" }));

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 150;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [...ofArguments];
  for (const maker in makers) for (const between in betweens) for (const taker in takers) all.push(stretch(maker, between, taker));
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped), isTyped);
}
