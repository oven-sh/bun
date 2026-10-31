// A call of a name whose `--define` value is `require.resolve` asks for no file where its one argument is a string that names a built-in module: the answer is the name as it is asked, with or without `node:`.
// Flags: --define RES=require.resolve
console.log(RES("node:fs"), RES("path"), RES("node:fs/promises"));
