console.log("imported.cjs");
console.log(typeof require("os").platform, typeof require("node:os").platform);
console.log(typeof require("sys").inspect, typeof require("node:sys").inspect);
console.log(typeof require(process.argv.length > 5 ? "path" : "os").platform);
console.log(require.resolve("os"), require.resolve("node:os"), require.resolve("sys"));
