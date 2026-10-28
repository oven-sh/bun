// generated/keys-of-objects-that-node-modules-hand-out.ts: an object of node:events, node:stream, node:net or node:http lists the same keys,
// with the same attributes and kinds of values, in an executable as in plain Bun: when it is new, and behind each of its public methods.
import { numberOfMethodsOf, programAbout, subjects } from "./generated/keys-of-objects-that-node-modules-hand-out";
import { generated } from "./generated/run-generated";

const methodsInOneProgram = 32;

generated(
  "objects that the modules of Node.js hand out list what they list in plain Bun",
  subjects.flatMap(subject =>
    Array.from({ length: Math.max(1, Math.ceil(numberOfMethodsOf(subject) / methodsInOneProgram)) }, (_, part) => ({
      name: `${subject.name}, part ${part + 1}.`,
      isAlwaysRun: true,
      wasOnceWrong: subject.inExchange === "socket" && part === 0,
      isOnlyCompiled: true as const,
      keepsItsText: true as const,
      make: () => ({
        file: "main.js",
        text: programAbout(subject, part * methodsInOneProgram, (part + 1) * methodsInOneProgram),
      }),
    })),
  ),
);
