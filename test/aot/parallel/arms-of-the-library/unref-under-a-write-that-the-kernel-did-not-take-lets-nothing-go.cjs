// In src/js/node/net.ts, unref() under a write that waits for the kernel leaves the hold to that write. Its second text has to as well.
process.argv.push("client", "after");
require("../../../js/node/net/node-net-unref-pending-write-fixture.js");
