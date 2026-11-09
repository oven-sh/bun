import fs = require("node:fs");
{ console.log(fs()); function fs() { return "inner"; } }
console.log(typeof (fs as any).readFileSync);
