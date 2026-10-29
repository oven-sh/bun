// A module imports a name through two star exports of a file that never stores it.
import { one } from "./step.mjs";
console.log("the entry point runs");
try {
  console.log(one);
} catch (error) {
  console.log(error.name);
}
