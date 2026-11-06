// A CommonJS file defines a getter that is not enumerable and returns a name of a second file. No namespace object has the name. Where a second getter
// of the file computes what it returns, an import statement does not find the name either.
import * as all from "./lib.cjs";
import * as whole from "./whole.cjs";
import * as throughStar from "./star.mjs";
import * as marked from "./marked.cjs";
import * as overData from "./over-data.cjs";

console.log(overData.x);
console.log(Object.keys(all).join(), all.x, "x" in all);
console.log(JSON.stringify(whole), Object.keys(whole.default).join(), whole.default.x);
console.log(Object.keys(throughStar).join(), throughStar.x, "x" in throughStar);
console.log(Object.keys(marked).join(), marked.x, marked.y, marked.default);
const later = await import("./later.cjs");
console.log(Object.keys(later).join(), later.x, "x" in later);
try {
  await import("./beside-a-getter-that-computes.mjs");
} catch (error) {
  console.log(error.name, error.message.includes("'x'"));
}
