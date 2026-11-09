// What a module namespace object answers. Each object is asked one thing, or one thing of each export, so nothing else in the program says which of its exports are needed.
import { ask } from "./ask.mjs";
import "./imported/ask.mjs";
import "./handed-on/ask.mjs";
import "./empty/ask.mjs";
import "./commonjs/ask.mjs";
import "./not-yet-run/frozen.mjs";
import * as frozenInPlace from "./imported/frozen-in-place.mjs";

try {
  Object.freeze(frozenInPlace);
  console.log("frozen where it is imported");
} catch (error) {
  console.log(`${error.constructor.name}: ${error.message}`);
}

ask(
  "import()",
  await import("./called/frozen.mjs"),
  await import("./called/sealed.mjs"),
  await import("./called/tested.mjs"),
  await import("./called/listed.mjs"),
  await import("./called/named.mjs"),
  await import("./called/untouched.mjs"),
);
