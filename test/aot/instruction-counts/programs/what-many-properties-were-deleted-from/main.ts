// What many properties were deleted from
import { fresh, plain, reads, readsByKey, settled, stores, storesByKey, theLoopAlone } from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 the loop alone": n => theLoopAlone(plain, n),
  "1 stores into an untyped object": n => stores(plain, n),
  "1 stores into an object that many properties were deleted from": n => stores(fresh(), n),
  "1 stores into one that was so used, read, and so used again": n => stores(settled(), n),
  "2 stores by a key into an untyped object": n => storesByKey(plain, n),
  "2 stores by a key into an object that many properties were deleted from": n => storesByKey(fresh(), n),
  "2 stores by a key into one that was so used, read, and so used again": n => storesByKey(settled(), n),
  "3 reads a property of an untyped object": n => reads(plain, n),
  "3 reads a property of an object that many properties were deleted from": n => reads(fresh(), n),
  "3 reads a property of one that was so used, read, and so used again": n => reads(settled(), n),
  "4 reads by a key of an untyped object": n => readsByKey(plain, n),
  "4 reads by a key of one that was so used, read, and so used again": n => readsByKey(settled(), n),
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
