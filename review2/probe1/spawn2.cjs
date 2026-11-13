const { spawn } = require("node:child_process");
const N = +process.env.N || 500, n = +process.env.STDIO || 3;
const stdio = n === 3 ? ["ignore", "pipe", "pipe"] : n === 2 ? ["ignore", "pipe"] : ["ignore"];
let i = 0;
(function next() { if (i++ === N) return; const c = spawn("true", [], { stdio }); c.on("close", next); })();
