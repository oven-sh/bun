// Property cache misses
import { addFour, newShapeOnly, readFour, readFourMissing, replaceFour } from "./plain.js";

const cases: Record<string, (n: number) => unknown> = {
  "0 new shape only": n => newShapeOnly(n),
  "1 replace four properties, new shape": n => replaceFour(n),
  "2 add four properties, new shape": n => addFour(n),
  "3 read four own properties, new shape": n => readFour(n),
  "4 read four missing properties, new shape": n => readFourMissing(n),
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
