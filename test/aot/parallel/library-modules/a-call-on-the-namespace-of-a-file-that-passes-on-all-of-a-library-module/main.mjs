// `export * from "node:os"`: the namespace object of that file is only the receiver of a call. To make it takes the names of the library module and runs none of the getters
// behind its exports (`EOL` of node:os, `ReadStream` of node:fs), as for the library module's own namespace object: nothing else refers to them, and they are left out.
import * as fs from "./fs.mjs";
import * as os from "./os.mjs";
console.log(typeof os.hostname());
console.log(typeof fs.statSync("."));
