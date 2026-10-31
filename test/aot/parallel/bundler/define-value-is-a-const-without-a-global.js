// A `--define` whose value is one name reads the `const` of the file that has that name, where no global of that name exists.
// Flags: --define NAME=target
const target = "the binding of the file";
console.log("before the site");
console.log(NAME);
