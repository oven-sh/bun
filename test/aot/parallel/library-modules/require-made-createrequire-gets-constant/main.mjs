// `createRequire(import.meta.url)` is how an ES module gets a require(). A constant name given to what it returns keeps the library module, and a constant path the file, whether the function is held in a constant, called at once, or comes from the module object. The output is that of plain Bun.
import { createRequire } from "node:module";
import * as namespace from "module";
import moduleObject from "node:module";

const require = createRequire(import.meta.url);
console.log(require("node:os").EOL === "\n", typeof require("node:zlib").gzipSync, require("url") === require("node:url"));
console.log(typeof createRequire(import.meta.url)("node:dgram").createSocket);
console.log(typeof namespace.createRequire(import.meta.url)("node:readline").createInterface);

const other = moduleObject.createRequire(import.meta.url);
console.log(typeof other("node:vm").runInNewContext, other("./lib/data.cjs").answer, other("./lib/data.cjs") === require("./lib/data.cjs"));

const flag = process.argv.length > 99;
console.log(typeof require(flag ? "node:http2" : "node:v8").getHeapStatistics);
console.log(typeof require.resolve, require.resolve("node:os"));

try {
  early("node:tty");
} catch (error) {
  console.log(error.name);
}
const early = createRequire(import.meta.url);
