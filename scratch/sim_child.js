// Simulates what `--inspect-brk` should do, using the already-supported
// node:inspector open(port, host, /* wait */ true) path.
const inspector = require("inspector");
inspector.open(0, "127.0.0.1", true);
console.log("after-wait");
setTimeout(() => console.log("done"), 50);
