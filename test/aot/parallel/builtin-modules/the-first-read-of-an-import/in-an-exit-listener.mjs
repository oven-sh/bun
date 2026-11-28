// The first read of imports of node:readline and node:fs is made in a function that a listener of "exit" calls: the modules were loaded before, and nothing runs behind the listener.
import readline from "node:readline";
import { existsSync } from "node:fs";
const log = [];
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype
    ? "nothing above process"
    : "events above process";
function read() {
  log.push("read " + typeof readline.createInterface + " " + typeof existsSync);
}
process.on("exit", code => {
  log.push("exit " + code, above());
  process.nextTick(() => console.log("a tick behind exit"));
  Promise.resolve().then(() => console.log("a job behind exit"));
  read();
  console.log(log.join(", "));
});
log.push("body");
