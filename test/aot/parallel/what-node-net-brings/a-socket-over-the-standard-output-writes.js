const net = require("node:net");
const socket = new net.Socket({ fd: 1, writable: true, readable: false });
socket.write("first\n");
socket.cork();
socket.write("second\n");
socket.write(Buffer.from("third\n"));
socket.uncork();
socket.write("fourth\n", () => console.error("written", socket.bytesWritten > 0));
