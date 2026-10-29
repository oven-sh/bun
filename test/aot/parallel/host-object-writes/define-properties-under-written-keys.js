// Object.defineProperties is handed a literal, so the keys that it defines under are written in the program. Each row defines a member that the host makes when it is first looked for.
// None of them is read by its name, and the three objects go nowhere else.
// How a TypeError of the language names what is no function is not what is tested here.
const told = error => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what, run) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
const anew = value => ({ value, writable: true, enumerable: true, configurable: true });
attempt("two names", () => Object.defineProperties(process, { allowedNodeEnvironmentFlags: anew(1), finalization: anew(2) }) === process);
attempt("a name of the program, then a key in quotes", () => Object.defineProperties(process, { markOfThisProgram: anew(3), 0: anew(4), "stdin": anew(5) }) === process);
attempt("a key in brackets", () => Object.defineProperties(console, { ["_stdout"]: anew(6) }) === console);
attempt("a descriptor out of a getter", () => Object.defineProperties(console, { get _stderr() { return anew(7); } }) === console);
attempt("a member that takes no new definition", () => Object.defineProperties(Bun, { $: { enumerable: false } }) === Bun);
attempt("members that are there from the start", () => Object.defineProperties(process, { config: { enumerable: false }, features: { enumerable: false } }) === process);
attempt("no key", () => Object.defineProperties(process, {}) === process);
attempt("no second operand", () => Object.defineProperties(process));
const listed = [...Object.keys(process), ...Object.keys(console), ...Object.keys(Bun)];
for (const name of ["allowedNodeEnvironmentFlags", "finalization", "markOfThisProgram", "0", "stdin", "_stdout", "_stderr", "$", "config", "features"]) {
  console.log(name, listed.includes(name));
}
attempt("console.log", () => console.log("prints"));
