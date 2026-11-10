import * as library from "node:dgram";

// Under a name that nobody knows, so every function of the module is compiled.
(globalThis as any)[`held ${process.argv.length}`] = library;
const socket = library.createSocket("udp4");
socket.close();
console.log(socket instanceof library.Socket);
