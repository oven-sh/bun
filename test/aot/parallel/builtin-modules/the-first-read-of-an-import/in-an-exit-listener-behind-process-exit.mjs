// The first read of imports of node:child_process and node:fs is made in a function that a listener of "exit" calls, behind a process.exit(3) of the body.
// Exit code: 3
import { spawnSync } from "node:child_process";
import fs from "node:fs";
const log = [];
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype
    ? "nothing above process"
    : "events above process";
function read() {
  log.push("read " + typeof spawnSync + " " + typeof fs.readFileSync);
}
process.on("exit", code => {
  log.push("exit " + code, above());
  read();
  console.log(log.join(", "));
});
log.push("body");
process.exit(3);
