// The first read of two named imports of node:path is made in the catch handler of the deepest frame of a recursion that ran out of stack.
import { sep, basename } from "node:path";
let answer;
function dive() {
  try {
    dive();
  } catch (error) {
    if (answer !== undefined) return;
    answer = error.name;
    try {
      answer += ", " + typeof sep + ", " + typeof basename;
    } catch (inner) {
      answer += ", the read threw " + inner.name;
    }
  }
}
dive();
console.log(answer);
console.log(basename("/works/behind.it"));
