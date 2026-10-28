import { generated } from "./generated/run-generated";
import { changes, textOf } from "./generated/typed-instances-changed-through-built-ins";

const alwaysRun = new Set([
  "Object.assign from parsed data",
  "Array.of called on the class",
  "a setter on the prototype object",
  "Reflect.construct of Object for the class",
  "out of a CustomEvent",
]);

generated(
  "a typed instance that a built-in changes",
  Object.keys(changes).map(change => ({
    name: change,
    isAlwaysRun: alwaysRun.has(change),
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: textOf(change) }),
  })),
);
