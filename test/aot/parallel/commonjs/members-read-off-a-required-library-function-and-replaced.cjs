// What CommonJS code reads off the function that node:events exports is what the library put there, until somebody puts something else there.
const events = require("node:events");
const { EventEmitter } = require("node:events");
const Member = require("events").EventEmitter;
const stream = require("node:stream");
const { Readable } = require("node:stream");

const lines = [];
function report(label, value) {
  lines.push(label + ": " + value);
}

function constructEach() {
  const made = [new EventEmitter(), new Member(), new events.EventEmitter(), new Readable(), new stream.Readable()];
  return made.map(one => one instanceof EventEmitter && one.listenerCount("x")).join();
}
function readAgain() {
  return new events.EventEmitter().listenerCount("x");
}
function requireAgain() {
  return new (require("node:events").EventEmitter)().listenerCount("x");
}
function Heir() {
  events.EventEmitter.call(this);
}
Object.setPrototypeOf(Heir.prototype, EventEmitter.prototype);

for (let i = 0; i < 3; i++) report("as the library left it", constructEach());
report("one function", EventEmitter === Member && Member === events && events.EventEmitter === events);
report("heir", Object.keys(new Heir()).join());

class Other {
  constructor() {
    this.other = true;
  }
  listenerCount() {
    return 7;
  }
}
function plain() {
  this.plain = true;
}
report("before", readAgain() + " " + requireAgain());
events.EventEmitter = Other;
report("another class", readAgain() + " " + requireAgain());
report("the names read earlier", constructEach());
events.EventEmitter = plain;
report("heir of another function", Object.keys(new Heir()).join());
Object.defineProperty(events, "EventEmitter", {
  get() {
    lines.push("getter");
    return EventEmitter;
  },
  configurable: true,
});
report("behind a getter", readAgain() + " " + requireAgain());
delete events.EventEmitter;
for (const read of [readAgain, requireAgain]) {
  try {
    report("deleted", read());
  } catch (error) {
    report("deleted", error.constructor.name);
  }
}
events.EventEmitter = EventEmitter;
report("put back", readAgain() + " " + requireAgain() + " " + constructEach());
console.log(lines.join("\n"));
