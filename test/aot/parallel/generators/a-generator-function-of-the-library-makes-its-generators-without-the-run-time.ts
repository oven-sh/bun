// An async generator function of the library is called 3,000 times. It has no `prototype` of its own: while it stands as made, and the member above it too, its generators get the realm's structure in the stub
// COUNT: operation:operationAOTNewGenerator <= 40
import { Readable } from "node:stream";
const turns = Number(process.argv[2] ?? 3) * 1000;
const stream = new Readable({ read() {} });
const above = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
let made = 0;
let last: any;
for (let turn = 0; turn < turns; turn++) {
  last = stream[Symbol.asyncIterator]();
  if (Object.getPrototypeOf(last) === above || Object.getPrototypeOf(Object.getPrototypeOf(last)) === above) made++;
}
console.log(made, typeof last.next, Object.prototype.toString.call(last), last.stream === stream);
stream.push("a");
stream.push(null);
for await (const chunk of stream) console.log(String(chunk));
