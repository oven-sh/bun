const fs = require("node:fs");
const { waitFor, mark } = require("./waitfor.js");
const fd = +process.argv[2], BLOCKS = 6;
for (let k = 0; k < BLOCKS; k++) {
  if (k > 0) waitFor("seen" + (k - 1));
  fs.writeSync(fd, Buffer.alloc(1024, 97 + k));
  mark("written" + k);
}
