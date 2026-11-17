// console.log and Bun.inspect list what an object has of its own in the order in which it was laid, symbols among the names. A message of node:http holds some of its state under symbols.
import http from "node:http";

const keysShown = text => [...text.matchAll(/^  (\[?[A-Za-z_$][\w$]*(?:\([^)]*\))?\]?):/gm)].map(match => match[1]).join(" ");
const message = new http.OutgoingMessage();
console.log("fresh:", keysShown(Bun.inspect(message, { depth: 0 })));
message.setHeader("X-One", "1");
console.log("with a header:", keysShown(Bun.inspect(message, { depth: 0 })));
console.log(Bun.inspect(message, { depth: 2 }).split("\n").filter(line => line.includes("x-one")).join("|"));
