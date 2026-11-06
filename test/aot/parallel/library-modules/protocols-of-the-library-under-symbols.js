// The library looks for members under symbols that it hands out: util.inspect.custom, util.promisify.custom, the rejection handler of an emitter, errorMonitor, Symbol.asyncDispose of a server, Symbol.dispose of a timer and Symbol.asyncIterator of an interface. The program only defines or uses them; the library does the calling.
import util from "node:util";
import { EventEmitter, captureRejectionSymbol, errorMonitor } from "node:events";
import http from "node:http";
import net from "node:net";
import readline from "node:readline";
import { Readable } from "node:stream";

class Money {
  constructor(amount) { this.amount = amount; }
  [util.inspect.custom](depth, options, inspect) { return "Money<" + inspect(this.amount, options) + ">"; }
}
console.log(new Money(5), [new Money(6)], util.inspect({ price: new Money(7) }), `${util.format("%o", new Money(8))}`);
console.log({ [Symbol.for("nodejs.util.inspect.custom")]() { return "through Symbol.for"; } });

function legacy(callback) { callback(null, "the callback form"); }
legacy[util.promisify.custom] = () => Promise.resolve("the custom form");
console.log(await util.promisify(legacy)());

class Careful extends EventEmitter {
  constructor() { super({ captureRejections: true }); }
  [captureRejectionSymbol](error, event, ...args) { console.log("rejection of", event, error.message, args.join()); }
}
const careful = new Careful();
careful.on("job", async () => { throw new Error("failed later"); });
careful.emit("job", 1, 2);
await new Promise(resolve => setImmediate(resolve));
careful.on(errorMonitor, error => console.log("seen first:", error.message));
careful.on("error", error => console.log("then handled:", error.message));
careful.emit("error", new Error("an error"));

let port;
{
  await using server = http.createServer((request, response) => response.end("disposed later"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  console.log(await (await fetch("http://127.0.0.1:" + port, { headers: { connection: "close" } })).text());
}
console.log(await new Promise(resolve => net.connect(port, "127.0.0.1").on("error", error => resolve(error.code)).on("connect", () => resolve("still open"))));
{
  using timer = setTimeout(() => console.log("never fires"), 20);
  console.log(typeof timer[Symbol.dispose]);
}
await new Promise(resolve => setTimeout(resolve, 30));
const lines = readline.createInterface({ input: Readable.from(["x\ny\n"]) })[Symbol.asyncIterator]();
console.log((await lines.next()).value, (await lines.next()).value, (await lines.next()).done);
