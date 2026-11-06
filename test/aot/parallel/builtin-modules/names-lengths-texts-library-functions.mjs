// A member of a host object that is a function written in Bun's library is compiled code once the program enters it. Its name, its length and its text are what plain Bun has there: no name where plain Bun gives none, "get " in front of a getter, and no name in the text of a function that takes its name from the property it is written under.
import Module from "node:module";
import process from "node:process";
import { Buffer } from "node:buffer";
import { Console } from "node:console";

function show(label, f) {
  console.log(label, JSON.stringify(f.name), f.length, JSON.stringify(Function.prototype.toString.call(f)), Object.getOwnPropertyNames(f).sort().join(), JSON.stringify(Object.getOwnPropertyDescriptor(f, "name")));
}

console.log("_initPaths answers", Module._initPaths());
show("node:module._initPaths", Module._initPaths);

process._rawDebug("a line for stderr");
show("process._rawDebug", process._rawDebug);

const glob = new Bun.Glob("no-file-has-this-name-*.nothing");
console.log("scanSync finds", [...glob.scanSync({ cwd: import.meta.dir })].length);
let found = 0;
for await (const path of glob.scan({ cwd: import.meta.dir })) found++;
console.log("scan finds", found);
show("Bun.Glob.prototype.scan", Bun.Glob.prototype.scan);
show("Bun.Glob.prototype.scanSync", Bun.Glob.prototype.scanSync);

const bytes = Buffer.from(new ArrayBuffer(8), 2, 4);
console.log("offset", bytes.offset, "parent", bytes.parent.byteLength);
show("Buffer.prototype.offset", Object.getOwnPropertyDescriptor(Buffer.prototype, "offset").get);
show("Buffer.prototype.parent", Object.getOwnPropertyDescriptor(Buffer.prototype, "parent").get);

new Console(process.stdout, process.stderr).log("a line through a console of its own");
const symbols = Object.getOwnPropertySymbols(Console.prototype).filter(key => typeof Console.prototype[key] === "function");
for (const key of symbols.sort((a, b) => (String(a) < String(b) ? -1 : 1))) show("Console.prototype[" + String(key) + "]", Console.prototype[key]);
