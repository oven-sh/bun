// Env: NAME_FROM_OUTSIDE=node:util
const made = require(process.env.NAME_FROM_OUTSIDE);
let told;
try {
  told = typeof made.format;
} catch (error) {
  told = error.constructor.name + ": " + error.message.split(" because")[0];
}
console.log("format" in made, told);
