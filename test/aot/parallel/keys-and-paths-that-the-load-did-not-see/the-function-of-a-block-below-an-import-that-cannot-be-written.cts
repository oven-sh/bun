import fs = require("node:fs");
{ function fs() {} }
console.log(typeof (fs as any).readFileSync === "function" ? "OK" : "WRONG");
