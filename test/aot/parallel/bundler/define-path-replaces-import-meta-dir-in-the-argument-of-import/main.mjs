// The path of an `import()` begins with `import.meta.dir`, and a `--define` puts a member of an object of the file in its place: the build finds the file below the folder that the member names, not the one beside the program.
// Flags: --define import.meta.dir=folders.here
const folders = { here: import.meta.dirname + "/sub" };
console.log((await import(import.meta.dir + "/lib.mjs")).name);
