// The same through imports.
import { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

const request = new IncomingMessage(null);

function isRequest(value) {
  return value instanceof IncomingMessage;
}

console.log("untouched", isRequest(request), isRequest("text"));
Object.defineProperty(Readable, Symbol.hasInstance, { configurable: true, value: () => false });
console.log("no on Readable", isRequest(request), isRequest("text"));
Object.defineProperty(Readable, Symbol.hasInstance, { configurable: true, value: () => true });
console.log("yes on Readable", isRequest(request), isRequest("text"));
delete Readable[Symbol.hasInstance];
console.log("taken away", isRequest(request), isRequest("text"));
