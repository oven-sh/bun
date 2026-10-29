// A module imports a name through a star export of a file that replaced its exports object.
import { one } from "./step.mjs";
console.log("the entry point runs");
try {
  console.log(one);
} catch (error) {
  console.log(error.name);
}
