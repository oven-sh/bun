import { bases, operations, textOf } from "./generated/instances-of-classes-below-built-in-classes-in-typed-code";
import { generated } from "./generated/run-generated";

const basesInEveryRun = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Error",
  "Date",
  "RegExp",
  "DataView",
  "Uint8Array",
]);
const operationsInEveryRun = new Set([
  "Object.freeze",
  "Object.freeze twice",
  "Object.freeze behind a new property",
  "Object.freeze, then stores",
  "Object.setPrototypeOf, another class's",
  "Object.assign to it, parsed data",
  "handed to untyped code that changes it",
  "the class constructed for the class below",
]);
// A spread lists `isTrusted`, which the host defines on every Event, ahead of what the program has added. Plain Bun lists it behind.
const listsTheHostsOwnNameFirst = new Set([
  "Object.assign from it to a literal with its names",
  "a spread of it",
  "a spread of it with a member behind",
  "a spread of it with a member ahead",
  "taken apart with a rest",
]);

generated(
  "an instance of a class below a built-in class in typed code",
  Object.keys(bases).flatMap(base =>
    Object.keys(operations).map(operation => ({
      name: `${base}: ${operation}`,
      isAlwaysRun: basesInEveryRun.has(base) && operationsInEveryRun.has(operation),
      isOnlyCompiled: true as const,
      failsToday: base === "Event" && listsTheHostsOwnNameFirst.has(operation) ? "the order of the keys" : undefined,
      // `then` constructs the class with an executor, which the class of these programs does not hand on: the await throws, in plain Bun too, and nothing catches it.
      leavesAnError: base === "Promise" && operation === "awaited" ? (true as const) : undefined,
      make: () => ({ file: "main.ts", text: textOf(base, operation) }),
    })),
  ),
);
