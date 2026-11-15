import * as math from "./math.js";
import numbers from "./numbers.cjs";
import { show } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let checksum = 0;
for (let i = 0; i < 2000; i++) {
  for (const use in math) {
    const answer = math[use](i % 4);
    checksum += typeof answer === "number" ? answer : 1;
  }
}
console.log("checksum", checksum);

for (const name of Object.keys(numbers.values)) {
  for (const use of Object.keys(math)) {
    const value = numbers.values[name]();
    numbers.log.length = 0;
    let said;
    try {
      said = show(math[use](value));
    } catch (error) {
      said = "threw " + error.constructor.name;
    }
    console.log(use + "(" + name + ")", said, numbers.log.length ? "after " + numbers.log.join(", ") : "");
  }
}
console.log("honest again", math.twice(3), math.plusOne(3), math.incremented(3), math.sumBelow(3));
