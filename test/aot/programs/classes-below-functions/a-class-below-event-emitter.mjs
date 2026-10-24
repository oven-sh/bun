// A class of the program extends EventEmitter, under each of the names that node:events gives it.
import Default, { EventEmitter } from "node:events";
import * as events from "node:events";
class Bus extends EventEmitter {
  constructor() { super(); this.total = 0; }
  send(n) { return this.emit("n", n); }
}
class Quiet extends Default { heard = []; }
class Named extends events.EventEmitter { constructor(name) { super({ captureRejections: true }); this.name = name; } }
const bus = new Bus();
bus.on("n", function (n) { this.total += n; });
bus.once("n", n => console.log("first", n));
for (let i = 1; i <= 500; i++) bus.send(i);
console.log(bus.total, bus.listenerCount("n"), bus.eventNames().join(), Object.keys(bus).join());
const quiet = new Quiet();
quiet.on("word", word => quiet.heard.push(word)).emit("word", "a");
console.log(quiet.emit("word", "b"), quiet.emit("nothing"), quiet.heard.join(), Object.keys(quiet).join());
const named = new Named("n");
console.log(named.name, named.getMaxListeners(), Object.keys(named).join(), named instanceof Default, Default === EventEmitter);
try { named.emit("error", new Error("nobody listens")); } catch (error) { console.log(error.message); }
