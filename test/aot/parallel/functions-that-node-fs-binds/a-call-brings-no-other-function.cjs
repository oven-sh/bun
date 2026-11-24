// A call of one of these functions on the object of node:fs brings no other function of node:fs with it.
// STATISTIC: ImageFunctionsEmitted <= 900
const fs = require("node:fs");
const ask = call => { try { return String(call()); } catch (error) { return error.code; } };
console.log(ask(() => fs.appendFileSync("/no such folder/file", "text", { mode: 0o600 })), ask(() => fs.chmodSync("/no such folder/file", 0o600)), ask(() => fs.closeSync(-1)), ask(() => fs.fstatSync(1e6)));
console.log(ask(() => fs.statSync("/no such folder/file")), ask(() => fs.lstatSync("/no such folder/file")), ask(() => fs.readFileSync("/no such folder/file")), ask(() => fs.readdirSync("/no such folder/file")));
