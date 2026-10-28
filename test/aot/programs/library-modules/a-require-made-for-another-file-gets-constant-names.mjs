// A require that createRequire has made for another file finds other packages than the file's own, and the same library modules: one that is named by a constant is in, though nothing else names it. The output is that of plain Bun.
import { createRequire } from "module";
import * as moduleModule from "node:module";
var require = createRequire("/");
var Worker;
try {
  Worker = require("worker_threads").Worker;
} catch (e) {}
console.log("in a variable named require:", typeof Worker);
console.log("on the spot:", typeof createRequire("/somewhere/else/")("node:dgram").createSocket);
console.log("through the module's object:", typeof moduleModule.createRequire(process.cwd() + "/")("node:readline").createInterface);
console.log("with and without the prefix:", require("node:querystring") === require("querystring"));
const again = require;
console.log("through a second binding:", typeof again("node:tty").isatty);
try {
  require("no-such-package-anywhere");
} catch (error) {
  console.log("a package that is not there:", error.code);
}

let stored = createRequire("/");
stored = name => "mine " + name;
console.log("a binding that is stored to:", stored("node:zlib"));
{
  const createRequire = () => name => "own " + name;
  console.log("another function of that name:", createRequire("/")("node:zlib"));
}
