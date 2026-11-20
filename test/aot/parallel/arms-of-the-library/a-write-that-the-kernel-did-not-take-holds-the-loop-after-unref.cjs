// src/js/node/net.ts keeps the loop for a write that waits for the kernel on a socket that unref() was called on before it. Its second text has to as well.
process.argv.push("client", "before");
require("../../../js/node/net/node-net-unref-pending-write-fixture.js");
