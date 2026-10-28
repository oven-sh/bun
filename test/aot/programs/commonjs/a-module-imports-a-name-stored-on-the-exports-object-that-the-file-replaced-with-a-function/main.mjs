// The file exports a function and stores the name on the first exports object.
import { count } from "./file.cjs";
console.log("the entry point runs");
try {
  console.log(count);
} catch (error) {
  console.log(error.name);
}
