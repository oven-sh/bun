// One program of ./generators/unsound-types.ts: one hole in TypeScript's type system that needs no cast, tried in a few
// cases, each a random combination of a type, an arriving value, a place, a time and uses. AOT_FUZZ_UNSOUND_HOLES=a,b
// restricts the holes. AOT_FUZZ_UNSOUND_CASES=1 sets the number of cases per program.
import { programOf, type Program } from "./generators/unsound-types";
import type { Random } from "./random";

const holes = process.env.AOT_FUZZ_UNSOUND_HOLES?.split(",");

const cases = Number(process.env.AOT_FUZZ_UNSOUND_CASES) || undefined;

export const draw = (random: Random): Program => programOf(random, { holes, cases });

export function generate(random: Random): string {
  return draw(random).text;
}
