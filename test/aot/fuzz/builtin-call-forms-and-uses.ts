// Every built-in function from call-site-with-two-builtins.ts, crossed with every way to reach a call and every use of
// the result: each triple once, twenty per program. The program's index fixes its triples.
import {
  arrivals,
  builtIns,
  chooseFor,
  textOf,
  uses,
  type BuiltIn,
  type Choice,
} from "./call-site-with-two-builtins";
import { Random } from "./random";

const ways = (Object.keys(arrivals) as (keyof typeof arrivals)[]).filter(
  arrival => !arrival.startsWith("one of two names"),
);
export const inOne = 20;
export const triples = builtIns.length * ways.length * uses.length;
export const programs = Math.ceil(triples / inOne);

const writes = /\.push\(1\)|\.pop\(\)|answer(?:\.\w+|\[\d\]) = |delete answer/;
const isCalledOnWhatHoldsIt = /(?:Holder\.f|holder\.f|table\.\w+|(?:\w|\])\[[^\]]*\])(?:\?\.)?\(/;

/**
 * The blocks of a program, each after a line that names it, after the imports of all of them. A block that would print
 * something that differs by design is left out.
 */
export function programOfBlocks(blocks: { label: string; first: BuiltIn; second: BuiltIn; choice: Choice }[]): string {
  const imports = new Set<string>();
  const written = blocks.map(({ label, first, second, choice }) => {
    // These may return a built-in prototype. An executable rejects a store to it, and in plain Bun all later blocks
    // would see the store.
    if ([first, second].some(({ text }) => /getPrototypeOf$|__proto__/.test(text)) && writes.test(choice.use))
      return "";
    // An iterator helper never reaches the end of an async generator: each `next()` returns a promise, and a promise
    // has no `done`.
    if ([first, second].some(({ holder }) => holder.startsWith("Iterator")) && choice.receivers.some(receiver => receiver.includes("async function*"))) return ""; // prettier-ignore
    const body = textOf(choice)
      .replace(/^import .*;\n/gm, line => (imports.add(line), ""))
      // Called on the class that holds it, a string method sees the class's source text, which plain Bun prints in its
      // own form.
      .replace(/^(class Holder \{ static f = .*;) \}$/m, '$1 static toString() { return "Holder"; } }');
    // Called on the array that holds it, it sees the source text of the functions in the array, and an executable does
    // not have the library's source text.
    if (isCalledOnWhatHoldsIt.test(body) && (first.from || second.from)) return "";
    // The same happens when the two travel in a rest parameter `all` and the call is passed `all`: that is the array of
    // the two, not the function of that name.
    if (body.includes("...all)") && (first.from || second.from) && [...choice.operands, ...choice.receivers].some(text => /\ball\b/.test(text))) return ""; // prettier-ignore
    return `console.log(${JSON.stringify(`${label}: ${first.text} | ${second.text}`)});\n{\n${body}}\n`;
  });
  return [...imports].join("") + written.join("");
}

export function programOf(index: number, random: Random): string {
  return programOfBlocks(
    Array.from({ length: Math.min(triples, (index + 1) * inOne) - index * inOne }, (_, at) => {
      const number = index * inOne + at;
      // The function changes from block to block, the use from program to program, the call form slowest.
      const first = builtIns[number % builtIns.length];
      const second = random.pick(builtIns.filter(other => other !== first));
      return {
        label: `triple ${number}`,
        first,
        second,
        choice: {
          ...chooseFor(random, first, second, false),
          arrival: ways[Math.floor(number / (builtIns.length * uses.length))],
          use: uses[Math.floor(number / builtIns.length) % uses.length],
        },
      };
    }),
  );
}
