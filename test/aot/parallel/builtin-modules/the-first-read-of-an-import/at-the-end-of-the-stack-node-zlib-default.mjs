// The first read of a default import of node:zlib is made in the catch handler of the deepest frame of a recursion that ran out of stack.
import zlib from "node:zlib";
let answer;
function dive() {
  try {
    dive();
  } catch (error) {
    if (answer !== undefined) return;
    answer = error.name;
    try {
      answer += ", " + typeof zlib.gzipSync;
    } catch (inner) {
      answer += ", the read threw " + inner.name;
    }
  }
}
dive();
console.log(answer);
console.log(zlib.gunzipSync(zlib.gzipSync("works behind it")).toString());
