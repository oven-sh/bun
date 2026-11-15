// two namespace objects meet in one parameter, and a built-in or an operation takes from it what no written name says
import * as one from "./one.mjs";
import * as two from "./two.mjs";
function ask(space) {
  try {
    return Object.isSealed(space);
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
}
let total = 0;
for (let i = 0; i < 300; i++) total = (total + one.step(i) + two.step(i)) | 0;
console.log(total, ask(one));
console.log(ask(two));
