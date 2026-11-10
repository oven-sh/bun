const net = require("node:net");
const fs = require("node:fs");
const fd = fs.openSync(process.execPath, "r");
try { new net.Socket({ fd, writable: true }); console.log("made"); } catch (error) { console.log(error.code, error.message); }
fs.closeSync(fd);
