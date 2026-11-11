import events from "node:events";
import stream from "node:stream";
import hooks from "node:async_hooks";
function Fake() { this.fake = true; }
class FakeClass { fake = "class"; }
function make(i) { return [new events.EventEmitter(), new stream.Readable({ read() {} }), new hooks.AsyncLocalStorage()].map(one => String(one.fake)).join(); }
const said = [];
for (let i = 0; i < 6; i++) {
  if (i === 2) { events.EventEmitter = Fake; stream.Readable = FakeClass; }
  if (i === 4) hooks.AsyncLocalStorage = Fake;
  said.push(make(i));
}
console.log(said.join(" "));
