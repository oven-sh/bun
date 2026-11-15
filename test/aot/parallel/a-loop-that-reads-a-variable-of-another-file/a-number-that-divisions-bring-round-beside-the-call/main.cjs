var lib = require("./lib.cjs");
function digits(n) { let c = 0; while (n > 0) { c = lib.add(c, n % 10); n = Math.floor(n / 10); } return c; }
function run(rounds, start) { let s = 0; for (let r = 0; r < rounds; r++) s = (s + digits(start + r)) | 0; return s; }
console.log("SAID", run(Number(process.argv[2] || 1000), JSON.parse("123456789")));
