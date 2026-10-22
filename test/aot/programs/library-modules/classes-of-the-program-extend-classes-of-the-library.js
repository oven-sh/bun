// The library calls methods that the program wrote, by names it knows: _read, _write, _writev, _final, _transform, _flush, _construct, _destroy of streams; createConnection of an agent; emit of an emitter. No code of the program calls them.
import { Readable, Writable, Transform, Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import { Console } from "node:console";
import { AssertionError } from "node:assert";

const log = [];
class Numbers extends Readable {
  constructor(limit) { super({ objectMode: true }); this.limit = limit; this.next = 0; }
  _construct(done) { log.push("_construct"); done(); }
  _read() { this.push(this.next < this.limit ? this.next++ : null); }
  _destroy(error, done) { log.push("_destroy of Numbers"); done(error); }
}
class Doubler extends Transform {
  constructor() { super({ objectMode: true }); }
  _transform(value, encoding, done) { done(null, value * 2); }
  _flush(done) { this.push("flushed"); done(); }
}
class Sink extends Writable {
  constructor() { super({ objectMode: true }); this.values = []; }
  _write(value, encoding, done) { this.values.push(value); done(); }
  _final(done) { log.push("_final"); done(); }
}
const sink = new Sink();
await pipeline(new Numbers(3), new Doubler(), sink);
console.log(sink.values.join(), log.join());

class Batches extends Writable {
  batches = [];
  _writev(chunks, done) { this.batches.push(chunks.map(({ chunk }) => chunk.toString()).join("+")); done(); }
}
const batches = new Batches();
batches.cork();
batches.write("a");
batches.write("b");
batches.uncork();
batches.end("c");
await new Promise(resolve => batches.on("finish", resolve));
console.log(batches.batches.join());

class Echo extends Duplex {
  _read() {}
  _write(chunk, encoding, done) { this.push("echo " + chunk); done(); }
  _final(done) { this.push(null); done(); }
}
const echo = new Echo();
echo.end("duplex");
console.log((await echo.toArray()).join());

class Loud extends EventEmitter {
  emit(name, ...args) { log.push("emit " + String(name)); return super.emit(name, ...args); }
}
const loud = new Loud();
loud.on("x", () => {});
loud.emit("x");
console.log(log.filter(entry => entry.startsWith("emit")).join());

class CountingAgent extends http.Agent {
  connections = 0;
  createConnection(options, callback) { this.connections++; return net.createConnection(options, callback); }
}
class Greeter extends http.Server {
  constructor() { super((request, response) => response.end(this.greeting())); }
  greeting() { return "from a subclass of Server"; }
}
const server = new Greeter();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const agent = new CountingAgent();
console.log(await new Promise(resolve => http.get({ host: "127.0.0.1", port: server.address().port, agent }, response => { let text = ""; response.on("data", part => (text += part)).on("end", () => resolve(text)); })), agent.connections);
agent.destroy();
server.close();

class Prefixed extends Console {
  log(...args) { super.log("[prefixed]", ...args); }
}
new Prefixed(process.stdout).log("through a subclass of Console");
class Mine extends AssertionError {
  constructor() { super({ message: "mine", actual: 1, expected: 2 }); }
  get name() { return "Mine"; }
}
class Address extends URL {
  get shout() { return this.hostname.toUpperCase(); }
}
console.log(new Mine().name, new Mine().code, new Mine() instanceof Error, new Address("http://host.example/").shout);
