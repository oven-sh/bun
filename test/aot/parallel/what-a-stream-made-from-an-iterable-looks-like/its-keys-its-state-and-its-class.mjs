// What Readable.from() hands out, with and without options: its own keys in order, its state, its class, and who is asked for which option.
import { EventEmitter } from "node:events";
import { Duplex, Readable } from "node:stream";

const name = key => (typeof key === "symbol" ? key.toString() : key);
function describe(title, stream) {
  const state = stream._readableState;
  console.log("==", title);
  console.log("  keys", Reflect.ownKeys(stream).map(name).join());
  console.log("  events", Reflect.ownKeys(stream._events).map(name).join(), stream._eventsCount, stream.eventNames().map(name).join());
  console.log("  state keys", Reflect.ownKeys(state).map(name).join());
  console.log("  state", state.objectMode, state.highWaterMark, state.length, state.flowing, state.ended, state.sync, state.needReadable, state.autoDestroy, state.emitClose, state.defaultEncoding, state.encoding, state.constructed, JSON.stringify(state.buffer), JSON.stringify(state.pipes), state.awaitDrainWriters);
  console.log("  class", Object.getPrototypeOf(stream) === Readable.prototype, stream instanceof Readable, stream instanceof Duplex, stream.constructor.name, state instanceof Readable.ReadableState);
  console.log("  asked", stream.readableObjectMode, stream.readableHighWaterMark, stream.readableFlowing, stream.readable, stream.destroyed, stream.closed, stream.getMaxListeners());
  console.log("  methods", typeof stream._read, Object.hasOwn(stream, "_read"), typeof stream._destroy, Object.hasOwn(stream, "_destroy"), stream._construct);
  stream.destroy();
}
async function* steps() {
  yield 1;
}
function watched(options) {
  return new Proxy(options, {
    get(target, key) {
      console.log("  option read", name(key));
      return target[key];
    },
    ownKeys(target) {
      console.log("  options listed");
      return Reflect.ownKeys(target);
    },
  });
}

describe("no options", Readable.from(steps()));
describe("undefined", Readable.from(steps(), undefined));
describe("null", Readable.from(steps(), null));
describe("an empty list", Readable.from(steps(), {}));
describe("a mark of five", Readable.from(steps(), { highWaterMark: 5 }));
describe("bytes", Readable.from(steps(), { objectMode: false }));
describe("an encoding", Readable.from(steps(), { objectMode: false, encoding: "latin1" }));
describe("no close, no destruction by itself", Readable.from(steps(), { emitClose: false, autoDestroy: false }));
describe("options that tell who reads them", Readable.from(steps(), watched({ highWaterMark: 2 })));
describe("a list", Readable.from([1, 2]));
describe("a text", Readable.from("text"));
describe("called on nothing", Readable.from.call(undefined, steps()));
class Heir extends Readable {}
describe("called on an heir", Heir.from(steps()));
describe("a duplex", Duplex.from(steps()));

EventEmitter.defaultMaxListeners = 3;
describe("three listeners at most", Readable.from(steps()));
EventEmitter.defaultMaxListeners = 10;
EventEmitter.captureRejections = true;
describe("rejections are captured", Readable.from(steps()));
EventEmitter.captureRejections = false;

Readable.prototype._construct = function (done) {
  console.log("  constructed by the program");
  done();
};
const constructed = Readable.from(steps());
console.log("== a _construct on the prototype", constructed._readableState.constructed);
console.log("  ", await constructed.toArray(), constructed._readableState.constructed);
delete Readable.prototype._construct;

const before = Readable.from(steps());
const after = Readable.from(steps());
console.log("== two of them share nothing", before._events !== after._events, before._readableState !== after._readableState, before._readableState.buffer !== after._readableState.buffer);
console.log("  ", await before.toArray(), await after.toArray());
