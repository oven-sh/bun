const chosen = require(process.argv.length > 9 ? "node:vm" : "node:v8");
console.log(typeof chosen.serialize, typeof chosen.runInContext);
function load(name) {
  return require(name);
}
console.log(typeof load("zlib").gzipSync, typeof load("node:dgram").createSocket);
const table = { first: "node:readline", second: "node:tty" };
console.log(typeof require(table[process.argv.length > 9 ? "first" : "second"]).isatty);
const short = name => require(name);
console.log(typeof short("fs"), typeof short("path").join);
