// Behind a comma a call of a name whose `--define` value is `eval` is no direct eval, as `(0, eval)(..)` is none: it calls what the name `eval` holds in the function, here a parameter, and the function `eval` runs its text outside the function. `bun run` prints the call without the comma, which is a direct eval there. Plain Bun prints another output.
// Flags: --define RUN=eval
function read(eval) {
  var local = "the local";
  return (0, RUN)("typeof local");
}
console.log(
  read(eval),
  read(text => "a function got " + text),
);
/* Output:
undefined a function got typeof local
*/
