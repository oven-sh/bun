// Programs of fuzz/one-call-reaches-either-of-two-built-ins.ts: one call reaches either of two built-in functions, and one thing is done with what it answers.
// First a function that makes an ordinary object beside each of those that make a list or a buffer: however the two arrive, whatever is done with the answer. Then fixed seeds, which draw both functions.
import { arrivals, builtIns, generate, textOf, uses } from "./fuzz/one-call-reaches-either-of-two-built-ins";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const named = (text: string) => builtIns.find(builtIn => builtIn.text === text)!;
const makers = [
  "Object.keys",
  "Object.values",
  "Object.entries",
  "Object.getOwnPropertyNames",
  "Object.getOwnPropertySymbols",
  "Reflect.ownKeys",
  "Array",
  "Array.of",
  "Intl.getCanonicalLocales",
  "Buffer.alloc",
  "Buffer.concat",
];
const ways = (Object.keys(arrivals) as (keyof typeof arrivals)[]).filter(
  arrival => !arrival.startsWith("one of two names"),
);

generated("one call reaches either of two built-in functions", [
  ...makers.flatMap(maker =>
    ways.flatMap(arrival =>
      uses.map(use => ({
        name: `Proxy.revocable or ${maker} arrives as ${arrival}: ${use}.`,
        // Every run takes each way to arrive once and each use once; AOT_GENERATED=all takes all.
        isAlwaysRun:
          maker === makers[0] &&
          (arrival === ways[uses.indexOf(use) % ways.length] || use === uses[ways.indexOf(arrival) % 2]),
        wasOnceWrong:
          maker === makers[0] &&
          ["a parameter", "a conditional", "a table by index", "a field"].includes(arrival) &&
          ["@.length", "Array.isArray(@)"].includes(use),
        isOnlyCompiled: true as const,
        // Nothing is put into the text: a second look at the answer could tell the compiler what the first may not assume.
        keepsItsText: true as const,
        make: () => ({
          file: "main.mjs",
          text: textOf({
            first: named("Proxy.revocable"),
            second: named(maker),
            arrival,
            call: "plainly",
            use,
            receivers: ["undefined", "undefined"],
            operands: ["{}, {}"],
            isWrittenOut: true,
          }),
        }),
      })),
    ),
  ),
  ...Array.from({ length: 1200 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first forty-eight seeds.
    isAlwaysRun: index < 48,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
]);
