console.log("required.cjs");
const first = process.argv.length < 99;
console.log(typeof require("os").platform, typeof require("node:os").platform, typeof require("node:sys").inspect, require.resolve("os"), require.resolve("sys"));
asked.length = 0;
console.log(typeof require(first ? "os" : "path").platform, typeof require(first ? "sys" : "url").inspect, asked.splice(0).join());
console.log(require.resolve(first ? "sys" : "url"), asked.splice(0).join());
