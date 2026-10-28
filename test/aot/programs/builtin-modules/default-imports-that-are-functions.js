// The object of some modules of Bun is a function: the default import is constructed, called and extended like any other function. The object of node:fs is none, and calling it throws.
import AbortController from "abort-controller";
import assert from "node:assert";
import strictAssert from "node:assert/strict";
import EventEmitter from "node:events";
import fs from "node:fs";
import Module from "node:module";
import Stream from "node:stream";
import isValidUTF8 from "utf-8-validate";
import * as events from "node:events";

const emitter = new EventEmitter();
emitter.on("x", value => console.log("heard", value));
console.log("emit:", emitter.emit("x", 1), emitter.emit("y"));
console.log("node:events:", typeof EventEmitter, emitter instanceof EventEmitter, EventEmitter === events.default, EventEmitter === events.EventEmitter);

class Bus extends EventEmitter {
  send(value) {
    return this.emit("x", value);
  }
}
const bus = new Bus();
bus.once("x", value => console.log("bus heard", value));
console.log("subclass:", bus.send(2), bus.send(3), bus instanceof EventEmitter, Object.getPrototypeOf(Bus) === EventEmitter);

const stream = new Stream();
console.log("node:stream:", typeof Stream, stream instanceof Stream, stream instanceof EventEmitter, Object.getPrototypeOf(Stream) === EventEmitter);
console.log("inherited static:", typeof Stream.listenerCount, Stream.listenerCount === EventEmitter.listenerCount);

assert(true);
strictAssert(1);
for (const check of [assert, strictAssert]) {
  try {
    check(0, "zero is falsy");
  } catch (error) {
    console.log("assert:", error.name, error.message, error instanceof assert.AssertionError);
  }
}

console.log("abort-controller:", new AbortController().signal.aborted, AbortController.name);
console.log("node:module:", typeof Module, new Module("id").id, Module.name);
console.log("utf-8-validate:", typeof isValidUTF8, isValidUTF8(Buffer.from("a")), isValidUTF8(Buffer.from([0xff])));

console.log("own properties of a function:", EventEmitter.name, EventEmitter.length, typeof EventEmitter.prototype, Object.hasOwn(EventEmitter, "prototype"));
console.log("called through call and apply:", typeof assert.call(undefined, true), typeof assert.apply(undefined, [true]));

for (const call of [() => fs(), () => new fs()]) {
  try {
    call();
  } catch (error) {
    console.log("node:fs:", typeof fs, error.name);
  }
}
