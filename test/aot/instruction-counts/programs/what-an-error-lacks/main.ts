// What an Error lacks
import { asksWhetherItHas, errors, plain, readsWhatItHas, readsWhatItLacks, theLoopAlone } from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 the loop alone": n => theLoopAlone(plain, n),
  "1 reads a property that an untyped object lacks": n => readsWhatItLacks(plain, n),
  "1 reads a property that an Error lacks": n => readsWhatItLacks(errors, n),
  "2 asks whether an untyped object has a property that it lacks": n => asksWhetherItHas(plain, n),
  "2 asks whether an Error has a property that it lacks": n => asksWhetherItHas(errors, n),
  "3 reads a property that an untyped object has": n => readsWhatItHas(plain, n),
  "3 reads a property that an Error has": n => readsWhatItHas(errors, n),
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
