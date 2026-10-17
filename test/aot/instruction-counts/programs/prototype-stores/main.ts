// Stores to prototype objects
import {
  baseClasses,
  derivedObjects,
  plainObjects,
  prototypeObjects,
  functionPrototypes,
  readNumber,
  storeByKey,
  storeNumber,
  storeObject,
  emptyLoop,
  widePrototypeObjects,
} from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 empty loop": n => emptyLoop(plainObjects, n),
  "1 store number, plain object": n => storeNumber(plainObjects, n),
  "1 store number, prototype object": n => storeNumber(prototypeObjects, n),
  "1 store number out of line, prototype object": n => storeNumber(widePrototypeObjects, n),
  "1 store number, prototype property of a function": n => storeNumber(functionPrototypes, n),
  "1 store number, static field of a base class": n => storeNumber(baseClasses, n),
  "2 store object, plain object": n => storeObject(plainObjects, n, plainObjects[0]),
  "2 store object, prototype object": n => storeObject(prototypeObjects, n, plainObjects[0]),
  "3 store by computed key, plain object": n => storeByKey(plainObjects, n),
  "3 store by computed key, prototype object": n => storeByKey(prototypeObjects, n),
  "4 read number, prototype object": n => readNumber(prototypeObjects, n),
  "4 read inherited number": n => readNumber(derivedObjects, n),
};
const name = process.argv[2];
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  let last: unknown;
  for (const turns of process.argv.slice(3)) {
    last = cases[name](Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
