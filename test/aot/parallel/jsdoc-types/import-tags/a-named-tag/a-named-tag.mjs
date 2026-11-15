/** @import { thing } from "./kinds.mjs" */
console.log(typeof thing);
try {
  thing;
} catch (error) {
  console.log(error.name);
}
