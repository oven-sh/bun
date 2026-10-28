// The entry point imports m1.ts, which hands on the names of m3.cjs, and m2.cts, which calls import() on m3.cjs. m3.cjs requires the entry point while the graph of the entry point is loaded. require() returns, and m3.cjs runs to its end. Plain Bun prints another output.
export { first as firstOfm1_0 } from "./m1.ts";
import * as m2_1 from "./m2.cts";
const show = value =>
  value === null
    ? "null"
    : typeof value === "object" || typeof value === "function"
      ? typeof value +
        "{" +
        Reflect.ownKeys(value)
          .filter(
            key =>
              typeof key === "string" &&
              !["length", "name", "prototype", "arguments", "caller", "__esModule"].includes(key),
          )
          .join() +
        "}"
      : typeof value + ":" + String(value);
const tell = (label, read) => {
  let shown;
  try {
    shown = show(read());
  } catch (error) {
    shown = "throws " + error?.name;
  }
  console.log(label, shown);
};
const atTheEnd = (globalThis.atTheEnd ??= []);

console.log("m0 begins");
tell("m0 early m2 *", () => m2_1);
tell("m0 early m2 *.second", () => m2_1.second);
tell("m0 early m2 *.default", () => m2_1.default);
export const first = "m0.first";
export class second {
  static of = "m0";
}
export default class {
  static first = "m0";
}
atTheEnd.push(() => tell("m0 late m2 *", () => m2_1));
atTheEnd.push(() => tell("m0 late m2 *.second", () => m2_1.second));
atTheEnd.push(() => tell("m0 late m2 *.default", () => m2_1.default));
console.log("m0 ends");
setTimeout(async () => {
  while (atTheEnd.length) await atTheEnd.shift()();
  console.log("the end");
}, 0);
