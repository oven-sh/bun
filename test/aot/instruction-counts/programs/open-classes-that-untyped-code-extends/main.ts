// Open classes that only untyped code extends
import { addOne, type Core } from "./core.ts";
import { constructTyped, constructTypedAndCall, constructUntyped, constructUntypedAndCall, emptyLoop, makeTyped } from "./plain.js";

const one: Core = makeTyped();
const cases: Record<string, (n: number) => unknown> = {
  "0 empty loop": n => emptyLoop(n),
  "1 construct, the class in TypeScript": n => constructTyped(n),
  "1 construct, the class in JavaScript": n => constructUntyped(n),
  "2 construct and call an arrow function, the class in TypeScript": n => constructTypedAndCall(n),
  "2 construct and call an arrow function, the class in JavaScript": n => constructUntypedAndCall(n),
  "3 call an arrow function from typed code": n => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += addOne(one);
    return sum;
  },
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
