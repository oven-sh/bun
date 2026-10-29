// A commonjs file requires the entry point inside a require of a module that imports the entry point.
import "./first.cjs";
import "./second.cjs";
console.log("main runs");
export const answer = 42;
