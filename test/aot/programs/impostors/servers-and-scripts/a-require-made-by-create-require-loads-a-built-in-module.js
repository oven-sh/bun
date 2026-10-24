import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
console.log(require("node:os").EOL === "\n", typeof require("node:zlib").gzipSync, require("url") === require("node:url"));
