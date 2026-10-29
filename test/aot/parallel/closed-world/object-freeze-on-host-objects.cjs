// Object.freeze on an object of the host. Freezing and sealing define every own property anew, which has the host make the value of each member that it makes when it is first looked for:
// the code that makes them is in the executable though the program names none of them.
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + (error.code ? " " + error.code : "") + ": " + String(error.message).slice(0, 70)); }
}
attempt("Object.freeze(console)", () => Object.freeze(console) === console);
attempt("console afterwards", () => [Object.isFrozen(console), Object.isSealed(console), Object.isExtensible(console)].join(" "));
attempt("Object.freeze(process)", () => Object.freeze(process) === process);
attempt("process afterwards", () => [Object.isFrozen(process), Object.isSealed(process), Object.isExtensible(process)].join(" "));
attempt("a store to a member", () => { process.aNameOfMyOwn = 1; return typeof process.aNameOfMyOwn; });
attempt("a member that the program names", () => typeof process.platform);
attempt("Object.freeze(Bun)", () => Object.freeze(Bun) === Bun);
attempt("Bun afterwards", () => [Object.isFrozen(Bun), Object.isSealed(Bun), Object.isExtensible(Bun)].join(" "));
