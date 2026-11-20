// In src/js/node/net.ts the socket of `connect({ fd })` ends a write that waited for the kernel from the event loop alone. Its second text has to as well.
const glibc = process.report.getReport().header.glibcVersionRuntime;
process.argv.push("fd", process.platform === "darwin" ? "libc.dylib" : glibc ? "libc.so.6" : "/usr/lib/libc.so");
require("../../../js/node/net/node-net-write-callback-order-fixture.js");
