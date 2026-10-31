// A call of `require` names a file of the program, and the build finds such calls in the text of a file. The build stops at a call of a name whose `--define` value is `require`.
// Flags: --define REQ=require
console.log(REQ("./lib.cjs").name);
/* Build errors:
error: TS100050: --aot does not support --define REQ=require where REQ is called. The value is read as a name. A string needs quotes: --define 'REQ="require"'
*/
