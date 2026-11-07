// The cases of ./minifying-first-saves-no-code.ts: the rows of ./minifying-first-saves-no-code/rows.ts and the inputs of the bundler's own tests. parts.mts says in how many parts.
import { minifyingFirstSavesNoCode, type Case } from "./minifying-first-saves-no-code";
import { casesOfSuite, leftOut, suites } from "./minifying-first-saves-no-code/bundler-suites";
import { knownToday } from "./minifying-first-saves-no-code/known-today";
import { rows } from "./minifying-first-saves-no-code/rows";

export async function minifyingFirstInParts(part: number, parts: number) {
  const cases: Record<string, Case> = { ...rows };
  for (const suite of suites) Object.assign(cases, await casesOfSuite(suite));
  if (part === 1) console.error("Inputs of test/bundler that are left out: " + Object.entries(leftOut).map(([why, count]) => `${count} ${why}`).join(", ")); // prettier-ignore
  minifyingFirstSavesNoCode("compile/aot/minifying first saves no code", cases, knownToday, part, parts);
}
