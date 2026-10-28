// An operator is compiled for the way in which each of its two operands is kept: a whole number in a register, a fraction, a number that may be missing, one of a few texts, a reference.
// Every kind of value on the left x every kind on the right, through every operator, as a value, as the test of a branch and as what a field is given.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
function written(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : String(value); }
const marker = Symbol("marker");
`;

/** An expression over `n`, a small whole number, and its type. */
const kinds: Record<string, [string, string]> = {
  wholeNumber: [`(n * 3) | 0`, "number"],
  fewWholeNumbers: [`n & 3`, "number"],
  belowZero: [`-(n & 3) - 1`, "number"],
  unsigned: [`(n * 1431655765) >>> 0`, "number"],
  nearTheEndOfInt32: [`2147483646 + (n & 3)`, "number"],
  fraction: [`n + 0.5`, "number"],
  wholeFraction: [`Math.sqrt(n * n)`, "number"],
  notANumber: [`n % 2 ? NaN : n`, "number"],
  endless: [`n % 2 ? Infinity : -Infinity`, "number"],
  minusZero: [`n % 2 ? -0 : 0`, "number"],
  truth: [`n % 2 === 0`, "boolean"],
  text: [`"t" + n`, "string"],
  textOfANumber: [`String(n - 1)`, "string"],
  emptyText: [`n % 2 ? "" : " "`, "string"],
  oneOfTwoTexts: [`n % 2 ? "a" : "b"`, `"a" | "b"`],
  oneOfTwoTextsOfNumbers: [`n % 2 ? "1" : "02"`, `"1" | "02"`],
  bigNumber: [`BigInt(n - 1)`, "bigint"],
  veryBigNumber: [`BigInt(n) * 100000000000000000000n`, "bigint"],
  null: [`null`, "null"],
  undefined: [`undefined`, "undefined"],
  wholeNumberOrNothing: [`n % 3 ? n : undefined`, "number | undefined"],
  fractionOrNothing: [`n % 3 ? n + 0.5 : undefined`, "number | undefined"],
  wholeNumberOrNull: [`n % 3 ? n : null`, "number | null"],
  numberOrText: [`n % 2 ? n : "s" + n`, "number | string"],
  truthOrNumber: [`n % 2 ? n : n % 4 === 0`, "number | boolean"],
  textOrNothing: [`n % 2 ? "x" + n : undefined`, "string | undefined"],
  objectThatAnswers: [`{ valueOf() { return n; } }`, "{ valueOf(): number }"],
  objectThatAnswersAText: [`{ toString() { return "o" + n; } }`, "{ toString(): string }"],
  emptyObject: [`{}`, "{}"],
  list: [`[n]`, "number[]"],
  symbol: [`marker`, "symbol"],
  closure: [`() => n`, "() => number"],
  fromUnknownCode: [`unknown(n % 2 ? n : "u")`, "number | string"],
};

const binary = ["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>", "<", "<=", ">", ">=", "==", "!=", "===", "!=="];
const choosing = ["&&", "||", "??"];

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 100;

const somePlaces = ["once", "often", "loop", "handlerInALoop", "copiedIntoALoop", "inAClosure", "loopWithAYield", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const left in kinds)
    for (const right in kinds)
      for (const use of ["asAValue", "asATest", "intoAField"]) {
        const one = (operator: string) => {
          const result = `a ${operator} b`;
          const used = use === "asAValue" ? `say(written(${result}));` : use === "asATest" ? `if (${result}) hits++; else misses++;` : `holder.held = ${result}; say(written(holder.held));`;
          return `\n// @ts-ignore: not every pair is one that TypeScript lets meet\ntry { ${used} } catch { say("T"); }`;
        };
        all.push({
          name: `${left}-${right}-${use}`,
          beside,
          before: seed => `let hits = 0, misses = 0; const holder: { held: unknown } = { held: 0 }; const start = ${seed};`,
          body: () => `for (let n = start + now; n < start + now + 4; n++) { const a: ${kinds[left][1]} = ${kinds[left][0]}; const b: ${kinds[right][1]} = ${kinds[right][0]}; ${[...binary, ...choosing].map(one).join("")}\n}`,
          after: `hits + ":" + misses`,
        });
      }
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped, somePlaces), isTyped);
}
