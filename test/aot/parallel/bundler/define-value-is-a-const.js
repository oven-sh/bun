// A `--define` whose value is one name reads the `const` of the file that has that name, not the global of that name.
// Flags: --define NAME=target
const target = "the binding of the file";
globalThis.target = "the global";
console.log(NAME);
