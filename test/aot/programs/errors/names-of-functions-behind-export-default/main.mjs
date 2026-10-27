// Prints the name of each kind of function and class behind `export default`, and how a stack trace names it. In an executable one that has no name of its own is `default`.
import arrow from "./arrow.mjs";
import asyncFunction from "./async-function.mjs";
import asyncGenerator from "./async-generator.mjs";
import index from "./folder/index.mjs";
import generator from "./generator.mjs";
import named from "./named.mjs";
import parenthesized from "./parenthesized.mjs";
import plainFunction from "./plain-function.mjs";
import SomeClass from "./some-class.mjs";
import typed from "./typed.ts";
import waits from "./waits.mjs";
console.log("function |", plainFunction.name, "|", plainFunction());
console.log("async function |", asyncFunction.name, "|", await asyncFunction());
console.log("generator |", generator.name, "|", generator().next().value);
console.log("async generator |", asyncGenerator.name, "|", (await asyncGenerator().next()).value);
console.log("class |", SomeClass.name, "|", new SomeClass().place);
console.log("arrow function |", arrow.name, "|", arrow());
console.log("function in parentheses |", parenthesized.name, "|", parenthesized());
console.log("function in a TypeScript file |", typed.name, "|", typed());
console.log("function with a name |", named.name, "|", named());
console.log("function in the index file of a folder |", index.name, "|", index());
try {
  await waits();
} catch (error) {
  const frames = error.stack.split("\n").slice(1, 3);
  console.log("async function that waits |", frames.map(line => line.trim().replace(/\(.*[\/\\]/, "(")).join(" < "));
}
