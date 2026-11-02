// `require.resolve` takes a name whose `--define` value is a member of an object of the file: the build finds the file that the member names.
// Flags: --define LIB=paths.lib
const paths = { lib: "./lib.cjs" };
console.log(require.resolve(LIB).endsWith("lib.cjs"), require(require.resolve(LIB)).name);
