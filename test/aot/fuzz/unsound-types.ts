// One program of ../generated/unsound-types.ts: a hole of TypeScript's type system that needs no cast, tried in a few cases, each put together at random from a type, a value that arrives, a place, a time and uses.
// AOT_FUZZ_UNSOUND_HOLES=a,b draws from those holes only, also where they are listed as filed. AOT_FUZZ_UNSOUND_CASES=1 gives every program that many cases.
import { programOf, type Program } from "../generated/unsound-types";
import type { Random } from "./random";

const holes = process.env.AOT_FUZZ_UNSOUND_HOLES?.split(",");

const cases = Number(process.env.AOT_FUZZ_UNSOUND_CASES) || undefined;

export const draw = (random: Random): Program => programOf(random, { holes, cases });

export function generate(random: Random): string {
  return draw(random).text;
}
