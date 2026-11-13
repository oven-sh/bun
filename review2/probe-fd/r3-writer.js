const fs = require("node:fs");
const { waitFor, mark } = require("./waitfor.js");
const fd = +process.argv[2];
waitFor("go1");
fs.writeSync(fd, "1");
waitFor("go2");
fs.writeSync(fd, "2");
fs.closeSync(fd);
mark("written2");
