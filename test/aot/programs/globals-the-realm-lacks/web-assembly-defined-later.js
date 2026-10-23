// BUN_JSC_useWasm=0 takes the global WebAssembly away. The program puts something of its own under the name, and every later read sees it.
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
  attempt(when + " typeof", () => typeof WebAssembly);
  attempt(when + " bare read", () => String(WebAssembly).slice(0, 12));
  attempt(when + " in", () => "WebAssembly" in globalThis);
  attempt(when + " member of globalThis", () => typeof globalThis.WebAssembly);
  attempt(when + " call", () => WebAssembly());
}
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask("before");
}
attempt("store to the bare name", () => {
  WebAssembly = () => "stored";
  return "done";
});
ask("behind the store");
attempt("definition", () => {
  globalThis.WebAssembly = () => "of the program";
  return "done";
});
ask("behind the definition");
attempt("delete", () => delete globalThis.WebAssembly);
ask("behind the delete");
attempt("delete again", () => delete globalThis.WebAssembly);
console.log(told.join("\n"));
