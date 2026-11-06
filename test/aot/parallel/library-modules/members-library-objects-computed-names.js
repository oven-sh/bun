// Methods of objects that the library makes, picked by a name that is put together: a logger's console[level], a parser's buffer["read" + kind], an emitter's method of registration, a hash's encoding, a response's method, a stream's event helper.
// Env: PARTS=log,info,debug,UInt16LE,hex,emit,write,end,read,setHeader,writeHead,listen,address,close,cwd,uptime,escapeHTML,max,stringify
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import http from "node:http";

const parts = process.env.PARTS.split(",");
for (const level of parts.slice(0, 3)) console[level]("console." + level);
const buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
for (const kind of ["UInt8", "UInt16BE", "Int32LE", "BigUInt64BE", "FloatLE", "DoubleBE"]) console.log(kind, String(buffer["read" + kind](0)).slice(0, 12));
buffer["write" + parts[3]](0xffff, 0);
console.log(buffer.toString(parts[4]));

const emitter = new EventEmitter();
const heard = [];
for (const method of ["on", "once", "prependListener", "addListener", "prependOnceListener"]) emitter[method]("x", () => heard.push(method));
emitter[parts[5]]("x");
emitter[parts[5]]("x");
console.log(heard.join());

const stream = new PassThrough();
stream[parts[6]]("written by name");
stream[parts[7]]();
console.log(stream[parts[8]]().toString(), stream["readable" + "Ended"], stream["writable" + "Finished"]);

const server = http.createServer((request, response) => {
  response[parts[9]]("x-set", "by name");
  response[parts[10]](202);
  response[parts[7]]("answered");
});
await new Promise(resolve => server[parts[11]](0, "127.0.0.1", resolve));
const answer = await fetch("http://127.0.0.1:" + server[parts[12]]().port);
console.log(answer.status, answer.headers.get("x-set"), await answer.text());
server[parts[13]]();
console.log(process[parts[14]]().length > 0, typeof process[parts[15]](), Bun[parts[16]]("<"), Math[parts[17]](1, 2), JSON[parts[18]]([1]));
