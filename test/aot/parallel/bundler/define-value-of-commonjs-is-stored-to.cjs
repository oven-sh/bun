// Under `bun run` a store to a name whose `--define` value is `module`, `exports`, `require`, `__filename` or `__dirname` changes what the file has under that name. The build stops at each such store.
// Flags: --define MOD=module --define EXP=exports --define REQ=require --define FILE=__filename --define DIR=__dirname
const first = exports;
EXP = { stored: true };
MOD = { exports: "another module object" };
REQ = name => "asked for " + name;
FILE += "!";
[DIR] = ["stored"];
console.log(exports === first, exports.stored, module.exports, typeof require, __filename.endsWith("!"), __dirname);
/* Build errors:
error: TS100050: --aot does not support --define EXP=exports where EXP is stored to. The value is read as a name. A string needs quotes: --define 'EXP="exports"'
error: TS100050: --aot does not support --define MOD=module where MOD is stored to. The value is read as a name. A string needs quotes: --define 'MOD="module"'
error: TS100050: --aot does not support --define REQ=require where REQ is stored to. The value is read as a name. A string needs quotes: --define 'REQ="require"'
error: TS100050: --aot does not support --define FILE=__filename where FILE is stored to. The value is read as a name. A string needs quotes: --define 'FILE="__filename"'
error: TS100050: --aot does not support --define DIR=__dirname where DIR is stored to. The value is read as a name. A string needs quotes: --define 'DIR="__dirname"'
*/
