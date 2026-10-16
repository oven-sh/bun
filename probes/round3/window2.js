// after one Writable.prototype.write, how many of the next 1000 write() calls in the same turn reach the sink before process.exit()?
const { Writable } = require("node:stream");
Writable.prototype.write.call(process.stdout, "A\n");
for (let i = 0; i < 1000; i++) process.stdout.write("line\n");
process.exit(0);
