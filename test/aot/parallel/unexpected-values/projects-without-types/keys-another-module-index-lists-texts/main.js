import odd from "./keys.cjs";
import { show } from "./show.js";
import * as uses from "./uses.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let count = 0;
for (let i = 0; i < 2000; i++) for (const use in uses) count += uses[use](i % 3) === undefined ? 0 : 1;
console.log("count", count);
for (const key in odd.keys) {
  for (const use in uses) {
    odd.log.length = 0;
    let said;
    try {
      said = show(uses[use](odd.keys[key]()));
    } catch (error) {
      said = "threw " + error.constructor.name;
    }
    console.log(use + "(" + key + ")", said, odd.log.length ? "after " + odd.log.join(", ") : "");
  }
}
