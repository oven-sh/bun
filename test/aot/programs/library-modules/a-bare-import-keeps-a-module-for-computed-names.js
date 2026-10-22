// `import "node:dgram"` and nothing else of it: that keeps the module, and every loader finds it under a computed name, with the prefix and without. The output is that of plain Bun.
import "node:dgram";
import { createRequire } from "node:module";

const copy = require;
for (const name of process.env.NAMES.split(",")) {
  console.log(name, typeof require(name).createSocket, typeof (await import(name)).createSocket, typeof process.getBuiltinModule(name).createSocket);
  console.log(name, typeof import.meta.require(name).createSocket, typeof createRequire(import.meta.url)(name).createSocket, typeof copy(name).createSocket);
}
const socket = require(process.env.NAMES.split(",")[0]).createSocket("udp4");
console.log(typeof socket.bind);
socket.close();
