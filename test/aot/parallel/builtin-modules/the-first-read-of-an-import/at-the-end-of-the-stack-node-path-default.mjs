// The first read of a default import of node:path is made in the catch handler of the deepest frame of a recursion that ran out of stack.
import path from "node:path";
let answer;
function dive() {
  try {
    dive();
  } catch (error) {
    if (answer !== undefined) return;
    answer = error.name;
    try {
      answer += ", " + typeof path.sep + ", " + typeof path.basename;
    } catch (inner) {
      answer += ", the read threw " + inner.name;
    }
  }
}
dive();
console.log(answer);
console.log(path.basename("/works/behind.it"));
