// Dictionary-mode objects
import { dictionaries, plain, read, readByKey, permanentDictionaries, store, storeByKey, emptyLoop } from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 empty loop": n => emptyLoop(plain, n),
  "1 store, plain object": n => store(plain, n),
  "1 store, dictionary object": n => store(dictionaries(), n),
  "1 store, permanent dictionary object": n => store(permanentDictionaries(), n),
  "2 store by computed key, plain object": n => storeByKey(plain, n),
  "2 store by computed key, dictionary object": n => storeByKey(dictionaries(), n),
  "2 store by computed key, permanent dictionary object": n => storeByKey(permanentDictionaries(), n),
  "3 read, plain object": n => read(plain, n),
  "3 read, dictionary object": n => read(dictionaries(), n),
  "3 read, permanent dictionary object": n => read(permanentDictionaries(), n),
  "4 read by computed key, plain object": n => readByKey(plain, n),
  "4 read by computed key, permanent dictionary object": n => readByKey(permanentDictionaries(), n),
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
