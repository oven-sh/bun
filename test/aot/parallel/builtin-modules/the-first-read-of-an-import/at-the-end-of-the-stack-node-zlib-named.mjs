// The first read of a named import of node:zlib is made in the catch handler of the deepest frame of a recursion that ran out of stack.
import { gzipSync, gunzipSync } from "node:zlib";
let answer;
function dive() {
  try {
    dive();
  } catch (error) {
    if (answer !== undefined) return;
    answer = error.name;
    try {
      answer += ", " + typeof gzipSync;
    } catch (inner) {
      answer += ", the read threw " + inner.name;
    }
  }
}
dive();
console.log(answer);
console.log(gunzipSync(gzipSync("works behind it")).toString());
