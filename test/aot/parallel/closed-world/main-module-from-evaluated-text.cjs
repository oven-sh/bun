// No code of the program names process.mainModule. Evaluated text finds the module object there, as in `bun <file>`. An executable that is bundled and not compiled ahead of time answers undefined.
const twice = box => box.value * 2;
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
