// `import()` takes a name whose `--define` value is a member of an object of the file: the build finds the file that the member names.
// Flags: --define LIB=paths.lib
const paths = { lib: "./lib.mjs" };
console.log((await import(LIB)).name);
