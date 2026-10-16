// the raised window: a chunk that went through Writable.prototype.write, then write() + process.exit()
const { Writable } = require("node:stream");
Writable.prototype.write.call(process.stdout, "A");
process.stdout.write("B");
process.stdout.write("C\n");
process.exit(0);
