// A name whose `--define` value names a `let` is read left of a comma in the dead zone of the `let`: ReferenceError. Plain Bun prints another output.
// Flags: --define NAME=target
globalThis.target = "the global";
try {
  (NAME, console.log("nothing was read"));
} catch (error) {
  console.log(error.constructor.name);
}
let target = 1;
/* Output:
ReferenceError
*/
