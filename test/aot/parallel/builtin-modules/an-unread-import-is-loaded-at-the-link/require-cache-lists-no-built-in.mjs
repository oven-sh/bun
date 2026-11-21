// Built-in modules that the entry imports by statement are not listed in require.cache, before a binding is read and behind it, and a required one is not either.
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
const builtIns = () => JSON.stringify(Object.keys(require.cache).filter(key => !/[\\/]/.test(key)));
console.log("before a read:", builtIns());
console.log(typeof path.sep);
console.log("behind one read:", builtIns());
console.log(typeof fs.readFileSync, typeof zlib.gzipSync, typeof require("node:os").EOL);
console.log("behind the others:", builtIns());
