// Every built-in function of one-call-reaches-either-of-two-built-ins.ts, in every way to arrive at a call, with every use of the answer: each such triple once, twenty to a program, each in a block of its own.
// Which triples a program holds is fixed by its number. The other function that may arrive there, how the call is made and what it is handed is drawn. every-pair-of-built-ins-at-one-call.ts takes its blocks from here.
import {
  arrivals,
  builtIns,
  chooseFor,
  textOf,
  uses,
  type BuiltIn,
  type Choice,
} from "./one-call-reaches-either-of-two-built-ins";
import { Random } from "./random";

const ways = (Object.keys(arrivals) as (keyof typeof arrivals)[]).filter(
  arrival => !arrival.startsWith("one of two names"),
);
export const inOne = 20;
export const triples = builtIns.length * ways.length * uses.length;
export const programs = Math.ceil(triples / inOne);

const writes = /\.push\(1\)|\.pop\(\)|answer(?:\.\w+|\[\d\]) = |delete answer/;
const isCalledOnWhatHoldsIt = /(?:Holder\.f|holder\.f|table\.\w+|(?:\w|\])\[[^\]]*\])(?:\?\.)?\(/;

/** The blocks of a program, each under a line that names it, behind the imports of all of them. Nothing stands for a block that would print what differs by design. */
export function programOfBlocks(blocks: { label: string; first: BuiltIn; second: BuiltIn; choice: Choice }[]): string {
  const imports = new Set<string>();
  const written = blocks.map(({ label, first, second, choice }) => {
    // What these answer may be a prototype of the language. A store to it is refused in an executable, and in plain Bun all the blocks behind would see it.
    if ([first, second].some(({ text }) => /getPrototypeOf$|__proto__/.test(text)) && writes.test(choice.use))
      return "";
    // A helper of iterators never comes to the end of an async generator: each `next()` answers a promise, and a promise has no `done`.
    if ([first, second].some(({ holder }) => holder.startsWith("Iterator")) && choice.receivers.some(receiver => receiver.includes("async function*"))) return ""; // prettier-ignore
    const body = textOf(choice)
      .replace(/^import .*;\n/gm, line => (imports.add(line), ""))
      // Called on the class that holds it, a method of strings sees the text of the class, and plain Bun prints its own spelling of that.
      .replace(/^(class Holder \{ static f = .*;) \}$/m, '$1 static toString() { return "Holder"; } }');
    // Called on the list that holds it, it sees the text of the functions in the list, and an executable does not hold the text of the library's.
    if (isCalledOnWhatHoldsIt.test(body) && (first.from || second.from)) return "";
    // So it is where the two travel in a rest parameter `all` and the call is handed `all`: there that is the list of the two, not the function of that name.
    if (body.includes("...all)") && (first.from || second.from) && [...choice.operands, ...choice.receivers].some(text => /\ball\b/.test(text))) return ""; // prettier-ignore
    return `console.log(${JSON.stringify(`${label}: ${first.text} | ${second.text}`)});\n{\n${body}}\n`;
  });
  return [...imports].join("") + written.join("");
}

export function programOf(index: number, random: Random): string {
  return programOfBlocks(
    Array.from({ length: Math.min(triples, (index + 1) * inOne) - index * inOne }, (_, at) => {
      const number = index * inOne + at;
      // The function changes from block to block, the use from program to program, the way to arrive slowest.
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
