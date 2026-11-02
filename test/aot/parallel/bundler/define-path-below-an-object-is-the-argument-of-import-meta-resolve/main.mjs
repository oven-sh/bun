// `import.meta.resolve` takes a name whose `--define` value is a member of an object of the file: the build finds the file that it names.
// Flags: --define LIB=paths.lib
const paths = { lib: "./lib.mjs" };
const where = import.meta.resolve(LIB);
console.log(where.endsWith("lib.mjs"), (await import(where)).name);
