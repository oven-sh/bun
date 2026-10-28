// No code of the program names process.mainModule, the one way from the global scope to the module objects of a CommonJS program. Evaluated text finds undefined there, as it does in an
// executable that is bundled and not compiled ahead of time, so what the files export stays in the program.
const { twice } = require("./main-module-from-evaluated-text/helper.cjs");
function attempt(text) {
  try {
    console.log(text + ": " + (0, eval)(Buffer.from(text).toString()));
  } catch (error) {
    console.log(text + ": " + error.name);
  }
}
console.log(twice({ value: 21 }));
attempt("typeof process.mainModule");
attempt("'mainModule' in process");
attempt("typeof require");
attempt("typeof module");
