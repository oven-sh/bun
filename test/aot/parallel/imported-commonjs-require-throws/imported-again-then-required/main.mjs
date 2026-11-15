const word = r => r.status + (r.reason ? " " + r.reason.message : "");
const both = await Promise.allSettled([import("./fresh.mjs"), import("./gate.cjs")]);
const again = await Promise.allSettled([import("./gate.cjs")]);
let asked;
try {
  asked = String(import.meta.require("./gate.cjs"));
} catch (error) {
  asked = "threw " + error.message + " " + (error === both[1].reason);
}
console.log(both.map(word).join(), "|", again.map(word).join(), both[1].reason === again[0].reason, "|", asked, "|", globalThis.gates, globalThis.fails);
