// The same in a CommonJS file: createRequire(__filename), from a pattern, from the module object and from the call itself. The output is that of plain Bun.
const { createRequire } = require("module");
const moduleObject = require("node:module");

const first = createRequire(__filename);
const second = moduleObject.createRequire(__filename);
const third = require("node:module").createRequire(__filename);
console.log(typeof first("node:os").cpus, typeof second("node:zlib").gzipSync, typeof third("node:dgram").createSocket);
console.log(first("node:os") === require("node:os"));
