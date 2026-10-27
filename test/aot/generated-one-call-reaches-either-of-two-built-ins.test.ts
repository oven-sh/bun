// Programs of fuzz/one-call-reaches-either-of-two-built-ins.ts: one call reaches either of two built-in functions, and one thing is done with what it answers.
// First a function that makes an ordinary object beside each of those that make a list or a buffer: however the two arrive, whatever is done with the answer. Then the step of each kind of
// built-in iterator beside those that make a list: both are stored on the iterator and called there. Then functions that answer an object or nothing, where they answer nothing and where they
// answer an object. Then fixed seeds, which draw both functions.
import {
  builtIns,
  generate,
  textOf,
  uses,
  arrivalsOfAnyTwo as ways,
} from "./fuzz/one-call-reaches-either-of-two-built-ins";
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
// A receiver, operands for which the function answers nothing, and operands for which it answers an object.
const finders = [
  ["RegExp.prototype.exec", "/(a)|b/g", "null", '"ab"'],
  ["String.prototype.match", '"x"', "/a/", "/(x)/"],
  ["Object.getOwnPropertyDescriptor", "undefined", '{ a: 1 }, "b"', '{ a: 1 }, "a"'],
  ["Reflect.getOwnPropertyDescriptor", "undefined", '{ a: 1 }, "b"', '{ a: 1 }, "a"'],
  ["URL.parse", "undefined", '"x"', '"http://a.example/b?c=1"'],
  ["Map.prototype.get", 'new Map([["a", [1]]])', '"b"', '"a"'],
];
const steps = builtIns.filter(({ member, receivers }) => member === "next" && receivers);

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
            rejectsNothing: true,
          }),
        }),
      })),
    ),
  ),
  ...steps.flatMap(step =>
    makers.slice(0, 6).flatMap(maker =>
      uses.map(use => ({
        name: `${step.text} or ${maker} is stored on ${step.receivers![0]} and called there: ${use}.`,
        // Every run takes each use once.
        isAlwaysRun: maker === makers[0] && step === steps[uses.indexOf(use) % steps.length],
        wasOnceWrong: maker === makers[0] && step.holder.startsWith("(async ") && use === "@.length",
        isOnlyCompiled: true as const,
        keepsItsText: true as const,
        // The executable asks at each place whether what the compiler took for granted there holds.
        flags: ["--aot-validate"],
        make: () => ({
          file: "main.mjs",
          text: textOf({
            first: step,
            second: named(maker),
            arrival: "a field of the receiver",
            call: "plainly",
            use,
            receivers: [step.receivers![0], step.receivers![0]],
            operands: ["{ a: 1 }"],
            isWrittenOut: true,
            rejectsNothing: true,
          }),
        }),
      })),
    ),
  ),
  ...finders.flatMap(([finder, receiver, ...operands]) =>
    operands.flatMap((list, findsSomething) =>
      ways.flatMap(arrival =>
        uses.map(use => ({
          name: `${finder} answers ${findsSomething ? "an object" : "nothing"} and arrives as ${arrival}: ${use}.`,
          // Every run takes each way to arrive once and each use once.
          isAlwaysRun: finder === finders[0][0] && !findsSomething && arrival === ways[uses.indexOf(use) % ways.length],
          wasOnceWrong:
            !findsSomething &&
            (finder === finders[0][0] || finder === finders[1][0]) &&
            arrival === "a parameter of two calls" &&
            use === "@[1]",
          isOnlyCompiled: true as const,
          keepsItsText: true as const,
          make: () => ({
            file: "main.mjs",
            text: textOf({
              first: named(finder),
              second: named("Array.of"),
              arrival,
              call: "with call",
              use,
              receivers: [receiver, receiver],
              operands: [list],
              isWrittenOut: true,
              rejectsNothing: true,
            }),
          }),
        })),
      ),
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
