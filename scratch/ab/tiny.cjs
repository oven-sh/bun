const fs = require("node:fs");
const fd = fs.openSync(__filename, "r");
const buf = Buffer.alloc(1);
const mark = pos => fs.readSync(fd, buf, 0, 1, pos);
mark(1); mark(2);
mark(987654321);
let x = 0; for (let i = 0; i < 1000; i++) x += i;
mark(987654322);
console.log("done", x);
