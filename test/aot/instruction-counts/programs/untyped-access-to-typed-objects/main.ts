// Untyped access to typed objects
import {
  makePlain,
  readNumber,
  readObject,
  readOptional,
  readString,
  storeNumber,
  storeObject,
  storeString,
  emptyLoop,
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
  "0 empty loop": n => emptyLoop(records, n),
  "1 store number, record": n => storeNumber(records, n),
  "1 store number, class instance": n => storeNumber(instances, n),
  "1 store number, plain object": n => storeNumber(plain, n),
  "2 store string, record": n => storeString(records, n, "v"),
  "2 store string, class instance": n => storeString(instances, n, "v"),
  "2 store string, plain object": n => storeString(plain, n, "v"),
  "3 store object, record": n => storeObject(records, n, records[0]),
  "3 store object, class instance": n => storeObject(instances, n, instances[0]),
  "3 store object, plain object": n => storeObject(plain, n, plain[0]),
  "4 read number, record": n => readNumber(records, n),
  "4 read number, class instance": n => readNumber(instances, n),
  "4 read number, plain object": n => readNumber(plain, n),
  "5 read string, record": n => readString(records, n),
  "5 read string, class instance": n => readString(instances, n),
  "5 read string, plain object": n => readString(plain, n),
  "6 read object, record": n => readObject(records, n),
  "6 read object, class instance": n => readObject(instances, n),
  "6 read object, plain object": n => readObject(plain, n),
  "7 read missing optional field, record": n => readOptional(records, n),
  "7 read missing optional field, class instance": n => readOptional(instances, n),
  "7 read missing property, plain object": n => readOptional(plain, n),
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
