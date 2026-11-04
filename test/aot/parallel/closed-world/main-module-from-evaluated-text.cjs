// No code of the program names process.mainModule, the one name of the global scope that holds a module object of a CommonJS program. Evaluated text finds undefined there, as it does in an
// executable that is bundled and not compiled ahead of time, so what the files export stays in the program. evaluated-text-traps-a-name-above-the-module-objects has the other way:
// a getter above the module objects, which a file of the program enters with its own `module`.
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
/* Output:
42
typeof process.mainModule: undefined
'mainModule' in process: true
typeof require: undefined
typeof module: undefined
*/
