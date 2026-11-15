// A call of appendFileSync, chmodSync or closeSync on the object of node:fs lets no other function of node:fs go, beside node:net either.
// STATISTIC: ImageFunctionsEmitted <= 1900
import fs from "node:fs";
import "node:net";
const ask = call => { try { return String(call()); } catch (error) { return error.code; } };
console.log(ask(() => fs.appendFileSync("/no such folder/file", "text", { mode: 0o600 })), ask(() => fs.chmodSync("/no such folder/file", 0o600)), ask(() => fs.closeSync(-1)));
console.log([-1, -2].map(descriptor => ask(() => fs.closeSync(descriptor))).join(), ask(() => fs.closeSync(...["none"])));
