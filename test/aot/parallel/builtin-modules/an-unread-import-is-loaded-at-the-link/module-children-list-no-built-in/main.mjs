// Built-in modules that ES files import by statement and CommonJS files require are in no module.children and not in require.cache, before a binding is read and behind it.
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import look from "./look.cjs";
console.log("before a read:", look());
console.log(typeof path.sep, typeof fs.readFileSync, typeof zlib.gzipSync);
console.log("behind the reads:", look());
