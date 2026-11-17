const { Writable } = require("node:stream");
console.log("write" in process.stdout, process.stdout instanceof Writable, Object.keys(process.stderr).includes("fd"), Object.getPrototypeOf(process.stdin) !== null);
