// A variable that goes up or down by the same amount on every turn, and is compared with a limit, may be kept as a whole number in a register. It is still a number of JavaScript: it passes
// 2147483647 and 4294967295 without wrapping, stops telling neighbours apart behind 9007199254740992, may start at a fraction, at -0 or at no number at all, and may be compared with a
// limit that is a fraction, infinite or no number.
// Where the counter starts x its step x how it is compared with the limit x what is done with it, each in some places. No loop takes more than a few turns: a second count ends it.
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

/** Around which number the loop runs. */
const regions: Record<string, string> = {
  zero: "0",
  endOfInt32: "2147483647",
  startOfInt32: "-2147483648",
  endOfUint32: "4294967295",
  endOfInt52: "2251799813685247",
  endOfExactNumbers: "9007199254740991",
  startOfExactNumbers: "-9007199254740991",
  large: "1e21",
};

const steps: Record<string, { step: string; up: boolean }> = {
  one: { step: "1", up: true },
  minusOne: { step: "-1", up: false },
  two: { step: "2", up: true },
  minusThree: { step: "-3", up: false },
  aThousand: { step: "1000", up: true },
  aBillion: { step: "1000000000", up: true },
  minusABillion: { step: "-1000000000", up: false },
  half: { step: "0.5", up: true },
};

/** How the start and the limit reach the loop. `value` is an expression for a number. */
const sources: Record<string, { beside?: string; from: (value: string) => string; limit?: (value: string) => string }> = {
  roundedDownBelowAWrittenLimit: { beside: "function handOn(n: number): number { return n; }", from: value => `Math.floor(handOn(${value}))`, limit: value => value },
  roundedDown: { beside: "function handOn(n: number): number { return n; }", from: value => `Math.floor(handOn(${value}))` },
  cutOffBelowALength: { beside: "function handOn(n: number): number { return n; }", from: value => `Math.trunc(handOn(${value}))`, limit: value => `"abcdefgh".repeat(Math.max(0, Math.min(3, ${value}))).length` },
  written: { from: value => value },
  reckoned: { from: value => `(${value} + seedOf(0))` },
  outOfAList: { beside: "", from: value => `[${value}, 1][seedOf(0)]` },
  outOfAField: { from: value => `{ n: ${value}, other: "o" }.n` },
  outOfAText: { from: value => `(JSON.parse("[" + String(${value}) + "]") as number[])[0]` },
  aParameter: { beside: "function handOn(n: number): number { return n; }", from: value => `handOn(${value})` },
};

const starts: Record<string, (region: string, step: string) => string> = {
  threeStepsAhead: (region, step) => `${region} - 3 * ${step}`,
  atTheEnd: region => region,
  oneStepBehind: (region, step) => `${region} + ${step}`,
  aFractionAhead: (region, step) => `${region} - 2 * ${step} + 0.5`,
  minusZero: () => "-0",
  noNumber: () => "NaN",
};

const limits: Record<string, (region: string, step: string) => string> = {
  threeStepsBehind: (region, step) => `${region} + 3 * ${step}`,
  atTheEnd: region => region,
  aFractionBehind: (region, step) => `${region} + 2 * ${step} + 0.25`,
  infinite: (_, step) => `${step} * Infinity`,
  noNumber: () => "NaN",
};

const relations: Record<string, (counter: string, limit: string, up: boolean) => string> = {
  before: (counter, limit, up) => `${counter} ${up ? "<" : ">"} ${limit}`,
  upTo: (counter, limit, up) => `${counter} ${up ? "<=" : ">="} ${limit}`,
  limitFirst: (counter, limit, up) => `${limit} ${up ? ">" : "<"} ${counter}`,
  notEqual: (counter, limit) => `${counter} !== ${limit}`,
  theNextIsTested: (counter, limit, up) => `${counter} + 1 ${up ? "<" : ">"} ${limit}`,
};

const uses: Record<string, string> = {
  isSaid: "say(at);",
  isReckonedWith: "say(at + 1, at * 2, at - 1, at / 2);",
  isCutToBits: "say(at | 0, at >>> 0, at & 255, ~at);",
  isAnIndex: `say(list[at], "abc"[at], at in list);`,
  isMadeAText: "say(String(at), `${at}`, at.toString(16));",
  isCompared: "say(at === at + 1, at > 2147483647, Object.is(at, -0), Number.isInteger(at), Number.isSafeInteger(at));",
  isStored: "kept.push(at); holder.n = at; say(holder.n, kept.length);",
  isHeldByAClosure: "later.push(() => at);",
  isARemainder: "say(at % 7, at % 2 === 0, Math.floor(at / 3));",
};

function stretch(regionName: string, stepName: string, sourceName: string, startName: string, limitName: string, relationName: string, useName: string): Stretch {
  const [region, { step, up }, source] = [regions[regionName], steps[stepName], sources[sourceName]];
  return {
    name: `${regionName}-${stepName}-${sourceName}-${startName}-${limitName}-${relationName}-${useName}`,
    beside: `${source.beside ?? ""}
function seedOf(n: number): number { return n; }
const list = [10, 11, 12, 13];
const kept: number[] = [];
const holder = { n: 0 };
const later: (() => number)[] = [];
function left(): string { const text = kept.join() + "/" + later.map(each => each()).join(); kept.length = 0; later.length = 0; return text; }`,
    before: seed => `const first: number = ${source.from(starts[startName](region, step))}; const limit: number = ${(source.limit ?? source.from)(limits[limitName](region, step))}; let turns = ${seed};`,
    body: () => `for (let at = first; ${relations[relationName]("at", "limit", up)}; at += ${step}) { if (++turns > 9) { say("stopped"); break; } ${uses[useName]} } turns = 0;`,
    after: "left()",
  };
}

const somePlaces = ["once", "often", "moduleLoop", "loop", "twoLoops", "loopWithContinue", "handlerInALoop", "copiedIntoALoop", "alsoCalledWhereItSeldomRuns", "inAClosure", "method", "callsItself", "loopWithAYield", "loopWithAnAwait"];

export const oneIn = 700;

/** Dealt by the names, so that what is added to a list later leaves the other programs as they are. */
const dealt = (name: string, among: number, skip = 1): number => Number((BigInt(Bun.hash(name)) / BigInt(skip)) % BigInt(among));

export function programs(isTyped?: boolean) {
  const all = new Map<string, Stretch>();
  const names = { source: Object.keys(sources), start: Object.keys(starts), limit: Object.keys(limits), relation: Object.keys(relations), use: Object.keys(uses) };
  const add = (made: Stretch) => all.set(made.name, made);
  // Every region, step, start and limit; the rest takes turns.
  for (const region in regions)
    for (const step in steps)
      for (const start of names.start)
        for (const limit of names.limit) {
          const pairing = `${region}-${step}-${start}-${limit}`;
          add(stretch(region, step, names.source[dealt(pairing, names.source.length)], start, limit, names.relation[dealt(pairing, names.relation.length, 1009)], names.use[dealt(pairing, names.use.length, 1000003)]));
        }
  // Every region, source, relation and use, three steps to either side of the region.
  for (const region in regions)
    for (const source of names.source)
      for (const relation of names.relation)
        for (const use of names.use) for (const step of ["one", "minusOne", "aBillion"]) add(stretch(region, step, source, "threeStepsAhead", "threeStepsBehind", relation, use));
  return inEveryPlace([...all.values()], isTyped, somePlaces);
}
