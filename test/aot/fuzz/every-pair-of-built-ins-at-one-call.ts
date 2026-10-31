// Every pair of the built-in functions of one-call-reaches-either-of-two-built-ins.ts, each pair once, twenty pairs to a program, each in a block of its own. Which pairs a program holds is fixed by its number.
// How the two arrive at the call, how they are called and what is done with the answer is drawn.
import { programOfBlocks } from "./every-built-in-however-it-arrives-whatever-is-done-with-its-answer";
import { builtIns, chooseFor } from "./one-call-reaches-either-of-two-built-ins";
import { Random } from "./random";

export const inOne = 20;
export const pairs = (builtIns.length * (builtIns.length - 1)) / 2;
export const programs = Math.ceil(pairs / inOne);

/** The pair of that number: the pairs that lie `distance` apart in the list stand one behind the other, so that a program holds many different functions. */
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
