// The entry point reaches the module that imports what is not installed by static imports alone: plain Bun fails before the first line runs, and the build is refused.
import "./broken.mjs";
console.log("the entry runs");
