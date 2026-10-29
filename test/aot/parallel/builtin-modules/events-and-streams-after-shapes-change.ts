// node:events and the streams read and write the properties of objects that a program hands them. Each case first runs the same code many times with one shape, then changes something that the next run must see: an own property added, deleted, made an accessor; a method replaced on the object, on its class, on EventEmitter.prototype or Readable.prototype; a prototype put between or exchanged; an absent name that appears up the chain; objects of many shapes by turns; shapes that die and are collected.
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

const lines: string[] = [];
const warm = 300;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function heard(emitter: EventEmitter, name: string, ...all: unknown[]): string {
  const got: string[] = [];
  const listener = (...given: unknown[]) => got.push(given.join("+"));
  emitter.on(name, listener);
  const answered = emitter.emit(name, ...all);
  emitter.off(name, listener);
  return answered + " " + got.join("|") + " " + emitter.listenerCount(name);
}

{
  const emitter = new EventEmitter();
  for (let i = 0; i < warm; i++) heard(emitter, "x", i);
  lines.push("plain: " + heard(emitter, "x", 1, 2));
  (emitter as any).extra = 1;
  lines.push("an own property more: " + heard(emitter, "x", 3));
  delete (emitter as any).extra;
  lines.push("deleted again: " + heard(emitter, "x", 4));
  const events = (emitter as any)._events;
  let reads = 0;
  Object.defineProperty(emitter, "_events", { configurable: true, get: () => (reads++, events), set() {} });
  lines.push("_events an accessor: " + heard(emitter, "x", 5) + " read " + (reads > 0));
  Object.defineProperty(emitter, "_events", { configurable: true, writable: true, enumerable: true, value: events });
  lines.push("_events a value again: " + heard(emitter, "x", 6));
  (emitter as any)._events = { __proto__: null };
  (emitter as any)._eventsCount = 0;
  lines.push("_events replaced: " + heard(emitter, "x", 7));
  (emitter as any)._maxListeners = 1;
  lines.push("getMaxListeners: " + emitter.getMaxListeners());
}

{
  class Loud extends EventEmitter {}
  const loud = new Loud();
  for (let i = 0; i < warm; i++) heard(loud, "x", i);
  lines.push("a subclass: " + heard(loud, "x", 1));
  (loud as any).emit = function (this: EventEmitter, name: string, ...all: unknown[]) {
    return EventEmitter.prototype.emit.call(this, name, "own", ...all);
  };
  lines.push("emit on the object: " + heard(loud, "x", 2));
  delete (loud as any).emit;
  (Loud.prototype as any).emit = function (this: EventEmitter, name: string, ...all: unknown[]) {
    return EventEmitter.prototype.emit.call(this, name, "class", ...all);
  };
  lines.push("emit on the class: " + heard(loud, "x", 3));
  delete (Loud.prototype as any).emit;
  lines.push("emit inherited again: " + heard(loud, "x", 4));
  const between = Object.create(EventEmitter.prototype);
  between.listenerCount = () => 99;
  Object.setPrototypeOf(Loud.prototype, between);
  lines.push("a prototype between: " + heard(loud, "x", 5));
  Object.setPrototypeOf(Loud.prototype, EventEmitter.prototype);
  lines.push("taken out again: " + heard(loud, "x", 6));
  Object.setPrototypeOf(loud, EventEmitter.prototype);
  lines.push("the object's prototype exchanged: " + heard(loud, "x", 7) + " " + (loud instanceof Loud));
}

{
  const emitter = new EventEmitter();
  for (let i = 0; i < warm; i++) heard(emitter, "x", i);
  const original = EventEmitter.prototype.on;
  let calls = 0;
  EventEmitter.prototype.on = function (this: EventEmitter, ...all: any[]) {
    calls++;
    return (original as any).apply(this, all);
  } as typeof original;
  lines.push("EventEmitter.prototype.on replaced: " + heard(emitter, "x", 1) + " calls " + calls);
  EventEmitter.prototype.on = original;
  lines.push("put back: " + heard(emitter, "x", 2) + " calls " + calls);
}

async function readAll(readable: Readable): Promise<string> {
  const got: string[] = [];
  readable.on("data", chunk => got.push(String(chunk)));
  await new Promise<void>(resolve => readable.on("close", resolve));
  return got.join("|") + " ended " + readable.readableEnded + " destroyed " + readable.destroyed;
}
function fresh(): Readable {
  const readable = new Readable({ read() {} });
  readable.push("a");
  readable.push("b");
  readable.push(null);
  return readable;
}
for (let i = 0; i < 60; i++) await readAll(fresh());
lines.push("a Readable: " + (await readAll(fresh())));
{
  const readable = fresh();
  const push = readable.push;
  (readable as any).tag = "own";
  readable.push = push;
  lines.push("with own properties more: " + (await readAll(readable)));
}
{
  const original = Readable.prototype.read;
  let calls = 0;
  Readable.prototype.read = function (this: Readable, size?: number) {
    calls++;
    return original.call(this, size);
  };
  lines.push("Readable.prototype.read replaced: " + (await readAll(fresh())) + " called " + (calls > 0));
  Readable.prototype.read = original;
  calls = 0;
  lines.push("put back: " + (await readAll(fresh())) + " called " + calls);
}
{
  const original = Readable.prototype.emit;
  const seen: string[] = [];
  (Readable.prototype as any).emit = function (this: Readable, name: string, ...all: unknown[]) {
    seen.push(name);
    return (original as any).call(this, name, ...all);
  };
  lines.push("an emit on Readable.prototype: " + (await readAll(fresh())) + " saw " + [...new Set(seen)].sort().join());
  delete (Readable.prototype as any).emit;
  seen.length = 0;
  lines.push("deleted: " + (await readAll(fresh())) + " saw " + seen.length);
}
{
  const readable = fresh();
  let asked = 0;
  const state = (readable as any)._readableState;
  Object.defineProperty(readable, "_readableState", { configurable: true, get: () => (asked++, state) });
  lines.push("_readableState an accessor: " + (await readAll(readable)) + " asked " + (asked > 0));
}
{
  const name = "domain";
  const emitter = new EventEmitter();
  for (let i = 0; i < warm; i++) heard(emitter, "x", i);
  lines.push("domain absent: " + String((emitter as any)[name]) + " " + heard(emitter, "x", 1));
  (EventEmitter.prototype as any)[name] = null;
  lines.push("domain null up the chain: " + String((emitter as any)[name]) + " " + heard(emitter, "x", 2));
  delete (EventEmitter.prototype as any)[name];
  lines.push("domain absent again: " + String((emitter as any)[name]) + " " + heard(emitter, "x", 3));
}

{
  const shapes: EventEmitter[] = [];
  for (let i = 0; i < 12; i++) {
    const emitter = new EventEmitter();
    for (let k = 0; k <= i; k++) (emitter as any)["p" + ((i * 7 + k) % 13)] = k;
    shapes.push(emitter);
  }
  let all = "";
  for (let round = 0; round < 40; round++) for (const emitter of shapes) all = heard(emitter, "x", round);
  lines.push("twelve shapes by turns: " + all);
  const many = new EventEmitter();
  for (let i = 0; i < 200; i++) (many as any)["k" + i] = i;
  for (let i = 0; i < 200; i += 2) delete (many as any)["k" + i];
  for (let i = 0; i < warm; i++) heard(many, "x", i);
  lines.push("an object that lost a hundred properties: " + heard(many, "x", 1));
  delete (many as any)._maxListeners;
  lines.push("and _maxListeners: " + many.getMaxListeners() + " " + heard(many, "x", 2));
}

{
  let last = "";
  for (let generation = 0; generation < 30; generation++) {
    const Made = class extends EventEmitter {
      generation = generation;
    };
    (Made.prototype as any)["only" + generation] = generation;
    for (let i = 0; i < 20; i++) last = heard(new Made(), "x", generation, i);
    if (generation % 5 === 4) {
      Bun.gc(true);
      await turn();
    }
  }
  lines.push("thirty classes that die: " + last);
}

{
  const written: string[] = [];
  const make = () =>
    new Writable({
      write(chunk, _encoding, done) {
        written.push(String(chunk));
        done();
      },
    });
  const finish = (writable: Writable) => new Promise<void>(resolve => writable.on("close", resolve));
  for (let i = 0; i < 60; i++) {
    const writable = make();
    writable.end("w");
    await finish(writable);
  }
  written.length = 0;
  const writable = make();
  const original = Writable.prototype.write;
  let calls = 0;
  Writable.prototype.write = function (this: Writable, ...all: any[]) {
    calls++;
    return (original as any).apply(this, all);
  } as typeof original;
  writable.write("a");
  writable.end("b");
  await finish(writable);
  Writable.prototype.write = original;
  lines.push("Writable.prototype.write replaced: " + written.join("|") + " calls " + calls + " finished " + writable.writableFinished);
}
console.log(lines.join("\n"));
