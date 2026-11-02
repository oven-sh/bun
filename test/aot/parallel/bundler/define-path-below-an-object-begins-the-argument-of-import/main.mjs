// A name whose `--define` value is a member of an object that holds `import.meta.dir` begins the path of an `import()`: the build finds the file.
// Flags: --define DIR=folders.here
const folders = { here: import.meta.dir };
console.log((await import(DIR + "/lib.mjs")).name);
