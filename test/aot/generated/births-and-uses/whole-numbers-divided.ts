// A quotient of two whole numbers that is rounded at once may be computed in whole numbers: where the divisor is not zero, the result is not a negative zero, and nothing is too large.
// What is divided x by what x how the quotient is rounded, each in some places. Every result is printed so that a negative zero shows.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `function written(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }\nconst lengths = [[], [1], [1, 2, 3], [1, 2, 3, 4, 5, 6, 7]];\n`;

/** Expressions over `n`, a whole number that goes through many values. */
const dividends: Record<string, string> = {
  theCounter: `n`,
  aByte: `(n * 37) & 255`,
  anInt32: `(n * 715827883) | 0`,
  anUnsigned: `(n * 715827883) >>> 0`,
  belowZero: `-(n & 7)`,
  aroundZero: `(n & 15) - 8`,
  aLength: `lengths[n & 3].length`,
  zero: `n & 0`,
  theSmallestInt32: `(n & 1) ? -2147483648 : 7`,
  theLargestInt32: `(n & 1) ? 2147483647 : -7`,
  beyondInt32: `n * 4294967296 + 5`,
  nearTheLargestExact: `9007199254740991 - n`,
  aProduct: `(n & 1023) * (n & 511)`,
};

const divisors: Record<string, string> = {
  one: `1`,
  two: `2`,
  three: `3`,
  seven: `7`,
  aPowerOfTwo: `64`,
  minusOne: `-1`,
  minusThree: `-3`,
  zero: `0`,
  fromZeroUp: `(n >> 1) & 3`,
  fromOneUp: `((n >> 1) & 3) + 1`,
  aroundZero: `((n >> 1) & 7) - 4`,
  aLength: `lengths[(n >> 1) & 3].length`,
  large: `1000000007`,
  theTurn: `by`,
};

const roundings: Record<string, (quotient: string) => string> = {
  floor: quotient => `Math.floor(${quotient})`,
  ceil: quotient => `Math.ceil(${quotient})`,
  trunc: quotient => `Math.trunc(${quotient})`,
  round: quotient => `Math.round(${quotient})`,
  orZero: quotient => `(${quotient}) | 0`,
  notNot: quotient => `~~(${quotient})`,
  shiftedByZero: quotient => `(${quotient}) >> 0`,
  unsignedShiftByZero: quotient => `(${quotient}) >>> 0`,
  floorThenOrZero: quotient => `Math.floor(${quotient}) | 0`,
  asAnIndex: quotient => `[5, 6, 7, 8][Math.floor(${quotient})] ?? -1`,
  remainder: quotient => quotient.replace(" / ", " % "),
  floorOfTheNegated: quotient => `-Math.floor(-(${quotient}))`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 60;

const somePlaces = ["once", "often", "loop", "twoLoops", "loopWithContinue", "handlerInALoop", "copiedIntoALoop", "inAClosure", "loopWithAYield", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const dividend in dividends)
    for (const divisor in divisors)
      for (const rounding in roundings)
        all.push({
          name: `${dividend}-${divisor}-${rounding}`,
          beside,
          before: seed => `let text = ""; const start = ${seed};`,
          body: turn => `const by = (${turn}) % 5; for (let n = start; n < start + 12; n++) text += written(${roundings[rounding](`(${dividends[dividend]}) / (${divisors[divisor]})`)}) + " ";`,
          after: "text",
        });
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped, somePlaces), isTyped);
}
