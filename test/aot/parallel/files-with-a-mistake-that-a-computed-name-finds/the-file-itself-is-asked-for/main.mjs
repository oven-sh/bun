globalThis.ran = [];
const name = JSON.parse(`"dial"`);
let outcome = "loaded";
try {
  await import("./parts/" + name + ".mjs");
} catch (error) {
  outcome = error.name;
}
console.log(outcome, "|", globalThis.ran.join() || "nothing ran");
