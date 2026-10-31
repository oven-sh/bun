// A store to a defined name whose `--define` value is `arguments` gives the name `arguments` of the function another value, and leaves the parameters as they are. Outside every function of a CommonJS file it does so for the arguments that the file itself is called with.
// Flags: --define ARGS=arguments
function replace(first) {
  ARGS = ["stored"];
  return [arguments[0], arguments.length, first].join();
}
console.log(replace("the argument", "another"));
function update() {
  ARGS &&= ARGS.length;
  ARGS++;
  return arguments;
}
console.log(update(1, 2, 3));
ARGS = { length: "of the file" };
console.log(arguments.length, typeof require);
