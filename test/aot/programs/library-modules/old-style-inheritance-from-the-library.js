// Packages from before classes: a constructor function calls the library's constructor on `this`, util.inherits or Object.setPrototypeOf joins the prototypes, and methods are stored one by one.
const util = require("node:util");
const EventEmitter = require("node:events");
const { Stream, Readable, Transform, Writable } = require("node:stream");

function Door() {
  EventEmitter.call(this);
  this.opened = 0;
}
util.inherits(Door, EventEmitter);
Door.prototype.open = function () {
  this.opened++;
  return this.emit("open", this.opened);
};
const door = new Door();
door.on("open", count => console.log("opened", count));
console.log(door.open(), door instanceof EventEmitter, Door.super_ === EventEmitter);

function Counter(limit) {
  if (!(this instanceof Counter)) return new Counter(limit);
  Readable.call(this, { encoding: "utf8" });
  this.limit = limit;
  this.count = 0;
}
Object.setPrototypeOf(Counter.prototype, Readable.prototype);
Object.setPrototypeOf(Counter, Readable);
Counter.prototype._read = function () {
  this.push(this.count < this.limit ? String(this.count++) : null);
};

function Brackets() {
  Transform.call(this);
}
util.inherits(Brackets, Transform);
Brackets.prototype._transform = function (chunk, encoding, done) {
  done(null, "[" + chunk + "]");
};

const parts = [];
const sink = new Writable({ write(chunk, encoding, done) { parts.push(chunk.toString()); done(); } });
Counter(3).pipe(new Brackets()).pipe(sink).on("finish", () => {
  console.log(parts.join(""));

  function Legacy() {
    Stream.call(this);
    this.readable = true;
  }
  util.inherits(Legacy, Stream);
  const legacy = new Legacy();
  const seen = [];
  legacy.pipe(new Writable({ write(chunk, encoding, done) { seen.push(chunk.toString()); done(); }, final(done) { console.log(seen.join()); done(); } }));
  legacy.emit("data", "from");
  legacy.emit("data", "a legacy stream");
  legacy.emit("end");
});
