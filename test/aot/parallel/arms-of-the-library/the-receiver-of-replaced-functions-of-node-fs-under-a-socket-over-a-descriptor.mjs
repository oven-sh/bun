// src/js/node/net.ts calls the functions of node:fs by their names only where the compiled program never holds the module's object. This one does.
import fs from "node:fs";
import net from "node:net";
const called = new Set();
let onModule = true;
for (const name of ["fstatSync", "writeSync", "closeSync"]) {
  const real = fs[name];
  fs[name] = function (...args) {
    called.add(name);
    onModule &&= this === fs;
    return real.apply(fs, args);
  };
}
const socket = new net.Socket({ fd: fs.openSync("/dev/null", "w"), readable: false, writable: true });
socket.end("x");
process.on("exit", () => console.log([...called].join(), onModule));
