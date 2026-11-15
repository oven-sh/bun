/** @import kinds from "./kinds.mjs" */
console.log(typeof kinds);
try {
  kinds;
} catch (error) {
  console.log(error.name);
}
