// Missing properties on Error objects
import { hasProperty, errors, plain, readOwn, readMissing, emptyLoop } from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 empty loop": n => emptyLoop(plain, n),
  "1 read missing property, plain object": n => readMissing(plain, n),
  "1 read missing property, Error": n => readMissing(errors, n),
  "2 in operator, missing property, plain object": n => hasProperty(plain, n),
  "2 in operator, missing property, Error": n => hasProperty(errors, n),
  "3 read own property, plain object": n => readOwn(plain, n),
  "3 read own property, Error": n => readOwn(errors, n),
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
