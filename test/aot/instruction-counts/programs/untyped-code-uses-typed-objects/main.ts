// Untyped code uses the objects of typed code
import {
  makePlain,
  readsNumber,
  readsObject,
  readsOptional,
  readsString,
  storesNumber,
  storesObject,
  storesString,
  theLoopAlone,
} from "./plain.js";

interface Shape {
  name: string;
  next: Shape | undefined;
  sides: number;
  label?: string;
}
class Corner {
  name: string = "a";
  next: Corner | undefined = undefined;
  sides: number = 3;
  label?: string;
}
const makeRecord = (): Shape => ({ name: "a", next: undefined, sides: 3 });
const records: Shape[] = [makeRecord(), makeRecord(), makeRecord(), makeRecord()];
const instances: Corner[] = [new Corner(), new Corner(), new Corner(), new Corner()];
const plain = [makePlain(), makePlain(), makePlain(), makePlain()];

const cases: Record<string, (n: number) => unknown> = {
  "0 the loop alone": n => theLoopAlone(records, n),
  "1 stores a number into a record": n => storesNumber(records, n),
  "1 stores a number into an instance": n => storesNumber(instances, n),
  "1 stores a number into an untyped object": n => storesNumber(plain, n),
  "2 stores a string into a record": n => storesString(records, n, "v"),
  "2 stores a string into an instance": n => storesString(instances, n, "v"),
  "2 stores a string into an untyped object": n => storesString(plain, n, "v"),
  "3 stores an object into a record": n => storesObject(records, n, records[0]),
  "3 stores an object into an instance": n => storesObject(instances, n, instances[0]),
  "3 stores an object into an untyped object": n => storesObject(plain, n, plain[0]),
  "4 reads a number of a record": n => readsNumber(records, n),
  "4 reads a number of an instance": n => readsNumber(instances, n),
  "4 reads a number of an untyped object": n => readsNumber(plain, n),
  "5 reads a string of a record": n => readsString(records, n),
  "5 reads a string of an instance": n => readsString(instances, n),
  "5 reads a string of an untyped object": n => readsString(plain, n),
  "6 reads an object of a record": n => readsObject(records, n),
  "6 reads an object of an instance": n => readsObject(instances, n),
  "6 reads an object of an untyped object": n => readsObject(plain, n),
  "7 reads an optional field that a record lacks": n => readsOptional(records, n),
  "7 reads an optional field that an instance lacks": n => readsOptional(instances, n),
  "7 reads a property that an untyped object lacks": n => readsOptional(plain, n),
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
