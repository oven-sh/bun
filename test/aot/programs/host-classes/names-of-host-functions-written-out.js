// Prints the name and the length of functions of Buffer, Bun, console, process and node:module. Each member is written out.
const { Glob } = Bun;
const Module = require("node:module");
const show = (label, name, length) => console.log(label, JSON.stringify(name), length);

show("Buffer.alloc", Buffer.alloc.name, Buffer.alloc.length);
show("Buffer.from", Buffer.from.name, Buffer.from.length);
show("Buffer.isBuffer", Buffer.isBuffer.name, Buffer.isBuffer.length);
show("Buffer.prototype.toJSON", Buffer.prototype.toJSON.name, Buffer.prototype.toJSON.length);
show("Buffer.prototype.write", Buffer.prototype.write.name, Buffer.prototype.write.length);
show("Bun.file", Bun.file.name, Bun.file.length);
show("Bun.peek", Bun.peek.name, Bun.peek.length);
show("Bun.peek.status", Bun.peek.status.name, Bun.peek.status.length);
show("Glob.prototype.match", Glob.prototype.match.name, Glob.prototype.match.length);
show("Glob.prototype.scan", Glob.prototype.scan.name, Glob.prototype.scan.length);
show("Glob.prototype.scanSync", Glob.prototype.scanSync.name, Glob.prototype.scanSync.length);
show("console.log", console.log.name, console.log.length);
show("console.write", console.write.name, console.write.length);
show("console[Symbol.asyncIterator]", console[Symbol.asyncIterator].name, console[Symbol.asyncIterator].length);
show("process.cwd", process.cwd.name, process.cwd.length);
show("process.loadEnvFile", process.loadEnvFile.name, process.loadEnvFile.length);
show("process._rawDebug", process._rawDebug.name, process._rawDebug.length);
show("Module._initPaths", Module._initPaths.name, Module._initPaths.length);
