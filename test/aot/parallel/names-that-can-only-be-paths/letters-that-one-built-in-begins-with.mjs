// "dgr" + name may be dgram and nothing else: the load finds the module whole, also what no import names.
import { createSocket } from "node:dgram";
const name = process.argv[5] ?? "am";
console.log(typeof createSocket, typeof require("dgr" + name).Socket);
