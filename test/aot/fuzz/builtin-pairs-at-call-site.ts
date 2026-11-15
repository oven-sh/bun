// Every pair of the built-in functions from call-site-with-two-builtins.ts, each pair once, twenty per program. The
// program's index fixes its pairs; how the two reach the call, how they are called and what is done with the result is
// random.
import { programOfBlocks } from "./builtin-call-forms-and-uses";
import { builtIns, chooseFor } from "./call-site-with-two-builtins";
import { Random } from "./random";

export const inOne = 20;
export const pairs = (builtIns.length * (builtIns.length - 1)) / 2;
export const programs = Math.ceil(pairs / inOne);

/**
 * The pair with that index: pairs that are `distance` apart in the list are adjacent, so that a program contains many
 * different functions.
 */
function pairAt(number: number): [number, number] {
  let distance = 1;
  while (number >= builtIns.length - distance) number -= builtIns.length - distance++;
  return [number, number + distance];
}

export function programOf(index: number, random: Random): string {
  return programOfBlocks(
    Array.from({ length: Math.min(pairs, (index + 1) * inOne) - index * inOne }, (_, at) => {
      const number = index * inOne + at;
      const [one, other] = pairAt(number);
      const [first, second] = random.chance(0.5) ? [builtIns[one], builtIns[other]] : [builtIns[other], builtIns[one]];
      return { label: `pair ${number}`, first, second, choice: chooseFor(random, first, second, false) };
    }),
  );
}
