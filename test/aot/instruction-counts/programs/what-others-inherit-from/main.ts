// What others inherit from is stored to
import {
  classes,
  heirs,
  lone,
  parents,
  prototypes,
  readsNumber,
  storesByKey,
  storesNumber,
  storesObject,
  theLoopAlone,
  wideParents,
} from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 the loop alone": n => theLoopAlone(lone, n),
  "1 stores a number into an object that nothing inherits from": n => storesNumber(lone, n),
  "1 stores a number into an object that others inherit from": n => storesNumber(parents, n),
  "1 stores a number out of line into an object that others inherit from": n => storesNumber(wideParents, n),
  "1 stores a number into the prototype of a function": n => storesNumber(prototypes, n),
  "1 stores a number into a static field of a class that is extended": n => storesNumber(classes, n),
  "2 stores an object into an object that nothing inherits from": n => storesObject(lone, n, lone[0]),
  "2 stores an object into an object that others inherit from": n => storesObject(parents, n, lone[0]),
  "3 stores by a key into an object that nothing inherits from": n => storesByKey(lone, n),
  "3 stores by a key into an object that others inherit from": n => storesByKey(parents, n),
  "4 reads a number of an object that others inherit from": n => readsNumber(parents, n),
  "4 reads a number that is inherited": n => readsNumber(heirs, n),
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
