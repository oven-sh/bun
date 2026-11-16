globalThis.ran = [];
const name = JSON.parse(`"panel"`);
let outcome = "loaded";
try {
  await import("./parts/" + name + ".mjs");
} catch (error) {
  outcome = "failed";
}
console.log(outcome, "|", globalThis.ran.join() || "nothing ran");
