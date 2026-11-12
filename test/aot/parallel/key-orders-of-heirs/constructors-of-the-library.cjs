// Heirs of the library's classes: the order of the keys that its constructors lay, by every way to run them, with own keys in front, behind and in between, and accessors above.
const { EventEmitter } = require("node:events");
const { Readable, Writable, Duplex } = require("node:stream");
const { OutgoingMessage, ServerResponse, ClientRequest } = require("node:http");
const util = require("node:util");
const out = [];
function show(object) {
  out.push(
    Reflect.ownKeys(object)
      .map(key => (typeof key === "symbol" ? "@" + key.description : key))
      .join(),
  );
  out.push(Object.keys({ ...object }).join(), JSON.stringify(Object.entries(object).filter(([key, value]) => typeof value !== "object" && typeof value !== "function")));
}
function heirs(Base, ...args) {
  function Behind() {
    Base.call(this, ...args);
    this.behind = 1;
  }
  util.inherits(Behind, Base);
  function Before() {
    this.before = "b";
    this._events = undefined;
    Base.call(this, ...args);
    this.behind = 2;
  }
  Object.setPrototypeOf(Before.prototype, Base.prototype);
  function Twice() {
    Base.call(this, ...args);
    this.between = [3];
    delete this._eventsCount;
    Base.call(this, ...args);
  }
  Twice.prototype = Object.create(Base.prototype, { constructor: { value: Twice } });
  class Classy extends Base {
    field = 0.5;
    constructor() {
      super(...args);
      this.last = null;
    }
  }
  class Lower extends Classy {
    lower = true;
  }
  return [Base, Behind, Before, Twice, Classy, Lower];
}
const families = [heirs(EventEmitter), heirs(Readable, { read() {} }), heirs(Writable, { write() {} }), heirs(Duplex, { read() {}, write() {} }), heirs(OutgoingMessage), heirs(ServerResponse, { method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} })];
function round() {
  for (const family of families) {
    for (const Heir of family) {
      try {
        show(family[0] === Heir && Heir !== EventEmitter && Heir !== OutgoingMessage ? Object.create(Heir.prototype) : new Heir());
      } catch (error) {
        out.push(error.name);
      }
    }
    const bare = Object.create(family[1].prototype);
    try {
      EventEmitter.call(bare);
      show(bare);
      family[1].call(bare);
      show(bare);
    } catch (error) {
      out.push(error.name);
    }
  }
}
for (let turn = 0; turn < 12; turn++) round();
Object.defineProperty(families[4][1].prototype, "_last", { set(value) { out.push("set " + value); }, get() { return "got"; }, configurable: true });
round();
Object.defineProperty(families[1][2].prototype, "_readableState", { value: 5, writable: true, configurable: true });
Object.defineProperty(families[0][4].prototype, "_maxListeners", { value: 7, writable: false, configurable: true });
round();
Object.freeze(families[5][1].prototype);
round();
out.push(typeof ClientRequest);
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, hash);
console.log(out.slice(0, 120).join("\n"));
