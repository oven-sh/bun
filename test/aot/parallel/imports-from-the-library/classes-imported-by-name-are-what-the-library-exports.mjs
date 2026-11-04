import events, { EventEmitter } from "node:events";
import stream, { Readable, Writable, Transform, Duplex, PassThrough } from "node:stream";
import hooks, { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
console.log(EventEmitter === events, events.EventEmitter === EventEmitter, stream.Readable === Readable, stream.Writable === Writable, stream.Transform === Transform, stream.Duplex === Duplex, stream.PassThrough === PassThrough, hooks.AsyncLocalStorage === AsyncLocalStorage, hooks.AsyncResource === AsyncResource);
let count = 0;
for (let i = 0; i < 50; i++) {
  const made = [new EventEmitter(), new Readable({ read() {} }), new Writable(), new Transform(), new Duplex(), new PassThrough(), new AsyncLocalStorage(), new AsyncResource("x")];
  count += made.filter((one, at) => one instanceof [EventEmitter, Readable, Writable, Transform, Duplex, PassThrough, AsyncLocalStorage, AsyncResource][at]).length;
  count += made.slice(1, 6).filter(one => one instanceof EventEmitter).length;
}
console.log(count);
