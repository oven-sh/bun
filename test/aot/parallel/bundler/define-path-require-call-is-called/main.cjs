// `require.call(..)` and `require.apply(..)` load a file, and the build finds the file where the text spells them. It stops at a call of a name whose `--define` value is one of the two paths.
// Flags: --define C=require.call --define A=require.apply
console.log(C(null, "./lib.cjs").name);
console.log(A(null, ["./lib.cjs"]).name);
/* Plain Bun prints:
lib
lib
*/
/* Build errors:
error: TS100050: --aot does not support --define C=require.call where C is called
error: TS100050: --aot does not support --define A=require.apply where A is called
*/
