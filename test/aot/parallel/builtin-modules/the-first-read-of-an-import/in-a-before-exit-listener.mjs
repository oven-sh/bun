// The first read of a default import of node:zlib is made in a listener of "beforeExit": the listener is called once, and the exit follows.
import zlib from "node:zlib";
const log = [];
process.on("beforeExit", code => {
  log.push("beforeExit " + code);
  if (log.length < 6) log.push("read " + typeof zlib.gzipSync);
});
process.on("exit", code => console.log(log.join(", "), "exit " + code));
log.push("body");
