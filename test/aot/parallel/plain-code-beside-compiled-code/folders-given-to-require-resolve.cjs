const path = require("node:path");
const ask = (paths) => { try { return path.basename(require.resolve("./folders-given-to-require-resolve.cjs", { paths })); } catch (error) { return error.code; } };
const missing = (paths) => { try { return path.basename(require.resolve("./no-such-file-beside-it.cjs", { paths })); } catch (error) { return error.code; } };
console.log("its own folder:", ask([__dirname]));
console.log("behind a folder that is not there:", ask([__dirname + "/nowhere", __dirname]));
console.log("only folders that are not there:", ask([__dirname + "/nowhere", __dirname + "/nowhere-else"]));
console.log("no folder:", ask([]));
console.log("a file that is not there:", missing([__dirname, __dirname + "/nowhere"]));
/* Output:
its own folder: folders-given-to-require-resolve.cjs
behind a folder that is not there: folders-given-to-require-resolve.cjs
only folders that are not there: MODULE_NOT_FOUND
no folder: MODULE_NOT_FOUND
a file that is not there: MODULE_NOT_FOUND
*/
