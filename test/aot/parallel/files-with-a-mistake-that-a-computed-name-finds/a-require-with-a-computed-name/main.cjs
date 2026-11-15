globalThis.ran = [];
const name = JSON.parse(`"panel"`);
let outcome = "loaded";
try {
  require("./parts/" + name + ".mjs");
} catch (error) {
  outcome = error.name;
}
console.log(outcome, "|", globalThis.ran.join() || "nothing ran");
