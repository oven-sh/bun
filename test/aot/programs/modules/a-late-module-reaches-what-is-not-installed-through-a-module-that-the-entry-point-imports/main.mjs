// The entry point imports the module that imports what is not installed, so plain Bun fails before the first line runs and the build stops.
// Two more modules reach that module too, and only late sites load them.
import "./broken.mjs";
console.log("the entry runs");
import("./late.mjs").catch(error => console.log(error.message));
try {
  require("./above-late.mjs");
} catch (error) {
  console.log(error.message);
}
