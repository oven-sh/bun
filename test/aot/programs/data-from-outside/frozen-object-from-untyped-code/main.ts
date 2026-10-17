// A typed function in one module gets an object that untyped code has frozen, sealed or otherwise made unchangeable. React's development build does this to props.
import { call } from "./untyped.js";
import { double, label, total } from "./typed";
const ways = ["plain", "freeze", "seal", "preventExtensions", "getter", "not writable", "null prototype", "one member more"];
for (const way of ways) {
  const results: unknown[] = [];
  for (const run of [() => call(double, { n: 21 }, way), () => call(label, { thing: { id: "a" }, children: "b" }, way), () => call(total, { list: [1, 2, 3] }, way)]) {
    try {
      results.push(run());
    } catch (error) {
      results.push((error as Error).name);
    }
  }
  console.log(way + ": " + results.join(", "));
}
