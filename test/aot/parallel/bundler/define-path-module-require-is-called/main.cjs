// `module.require` is the `require` of the file, and the build finds the files that a program loads in the calls of `require` that its text spells. The build stops at a call of a name whose `--define` value is `module.require`.
// Flags: --define LOAD=module.require
console.log(typeof LOAD, LOAD("./lib.cjs").name);
/* Build errors:
error: TS100050: --aot does not support --define LOAD=module.require where LOAD is called. The value is read as a name. A string needs quotes: --define 'LOAD="module.require"'
*/
