// A variable holds `import.meta.require`, and a `--define` whose value is the name of the variable calls it. The build finds the file that the call loads, as where the variable is spelled.
// Flags: --define LOAD=held
const held = import.meta.require;
console.log(LOAD("./lib.cjs").name);
