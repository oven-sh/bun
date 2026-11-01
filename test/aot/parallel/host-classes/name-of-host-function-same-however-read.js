// Reads the name of one function three ways in one program: through a key put together at run time, by Reflect.get(), and written out. Then prints the functions.
const join = (...parts) => parts.join("");
const bun = Reflect.apply(() => Bun, undefined, []);
const names = (holder, key, written) =>
  JSON.stringify([holder[join(key.slice(0, 2), key.slice(2))].name, Reflect.get(holder, key).name, written]);

console.log("console.write", names(console, "write", console.write.name));
console.log("Bun.peek", names(bun, "peek", Bun.peek.name));
console.log("Buffer.from", names(Buffer, "from", Buffer.from.name));
console.log("Buffer.isBuffer", names(Buffer, "isBuffer", Buffer.isBuffer.name));
console.log("process.loadEnvFile", names(process, "loadEnvFile", process.loadEnvFile.name));
console.log("console.log", names(console, "log", console.log.name));
console.log("Bun.file", names(bun, "file", Bun.file.name));
console.log(Bun.inspect([Buffer.from, Buffer.alloc, console.write, console.log, Bun.peek, process.loadEnvFile]));
console.log(require("node:util").inspect({ from: Buffer.from, write: console.write, peek: Bun.peek }));
