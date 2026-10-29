// A module re exports a name through a star export of a file that never stores it.
export { one } from "./step.mjs";
console.log("the entry point runs");
