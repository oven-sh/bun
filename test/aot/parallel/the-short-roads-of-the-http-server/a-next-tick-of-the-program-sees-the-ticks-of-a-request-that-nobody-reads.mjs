// A process.nextTick of the program's own that hands every tick on sees which callbacks the server queues for a GET whose request nobody reads, and with how many arguments.
import { createServer } from "node:http";
const original = process.nextTick;
let seen = [];
const server = createServer((req, res) => void res.end("got " + req.url));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const turn = () => new Promise(resolve => setImmediate(resolve));
console.log(await (await fetch(url + "/warm")).text());
await turn();
process.nextTick = function (callback, ...all) {
  seen.push((callback.name || "(anonymous)") + " " + all.length);
  return original.call(this, callback, ...all);
};
console.log(await (await fetch(url + "/one")).text());
await turn();
await turn();
process.nextTick = original;
console.log(seen.length);
console.log(seen.sort().join("\n"));
await new Promise(resolve => server.close(resolve));
/* Output:
got /warm
got /one
8
clearServerParserIncoming 2
emitCloseNT 1
emitEOFIncomingMessageOuter 1
emitErrorNextTickIfErrorListener 3
endReadableNT 2
finishResponse 1
markResponseEndedNT 1
resume_ 2
*/
