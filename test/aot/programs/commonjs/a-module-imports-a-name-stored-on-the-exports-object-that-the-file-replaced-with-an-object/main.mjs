// The file stores the name on the first exports object and then exports another object.
import { count } from "./file.cjs";
console.log("the entry point runs");
try {
  console.log(count);
} catch (error) {
  console.log(error.name);
}
