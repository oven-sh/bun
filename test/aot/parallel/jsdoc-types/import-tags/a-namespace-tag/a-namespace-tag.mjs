/** @import * as kinds from "./kinds.mjs" */
console.log(typeof kinds);
try {
  kinds.thing;
} catch (error) {
  console.log(error.name);
}
