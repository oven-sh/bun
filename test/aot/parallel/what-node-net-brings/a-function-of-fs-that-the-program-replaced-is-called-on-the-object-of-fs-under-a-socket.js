// node:net calls the functions of node:fs on the module's object, as a program that has replaced one can see.
const net = require("node:net");
const fs = require("node:fs");
for (const name of ["fstatSync", "writeSync", "closeSync"]) {
  const kept = fs[name];
  fs[name] = function (...given) {
    console.error(name, this === fs);
    return kept.apply(fs, given);
  };
}
try {
  new net.Socket({ fd: 987, writable: true });
} catch (error) {
  console.error(error.code);
}
const socket = new net.Socket({ fd: 1, writable: true, readable: false });
socket.write("first\n");
socket.cork();
socket.write("second\n");
socket.write("third\n");
socket.uncork();
