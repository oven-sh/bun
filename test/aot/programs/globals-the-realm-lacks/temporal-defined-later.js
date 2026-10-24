// BUN_JSC_useTemporal=0 takes the global Temporal away. The program puts something of its own under the name, and every later read sees it.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

function ask(when) {
  attempt(when + " typeof", () => typeof Temporal);
  attempt(when + " bare read", () => String(Temporal).slice(0, 12));
  attempt(when + " in", () => "Temporal" in globalThis);
  attempt(when + " member of globalThis", () => typeof globalThis.Temporal);
  attempt(when + " call", () => Temporal());
}
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask("before");
}
attempt("store to the bare name", () => {
  Temporal = () => "stored";
  return "done";
});
ask("behind the store");
attempt("definition", () => {
  globalThis.Temporal = () => "of the program";
  return "done";
});
ask("behind the definition");
attempt("delete", () => delete globalThis.Temporal);
ask("behind the delete");
attempt("delete again", () => delete globalThis.Temporal);
console.log(told.join("\n"));
