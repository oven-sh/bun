// A constructor function whose prototype holds defaults for some of the names that the constructor stores: Node's own idiom.
function Emitter() {
  this.listeners = null;
  this.count = 0;
}
Emitter.prototype.emit = function (name) {
  return this.count + name.length;
};
function Message(socket, url, method) {
  Emitter.call(this);
  this.socket = socket;
  this.complete = false;
  this.upgrade = null;
  this.url = url;
  this.method = method;
  this.trailers = null;
}
Object.setPrototypeOf(Message.prototype, Emitter.prototype);
Object.setPrototypeOf(Message, Emitter);
//DEFAULTS
Message.prototype.url = "";
Message.prototype.method = null;
Message.prototype.upgrade = null;
//END
Message.prototype.describe = function () {
  return this.method + " " + this.url + (this.upgrade === null ? "" : " upgrade") + (this.complete ? " complete" : "");
};
const rounds = Number(process.argv[2] ?? 1000);
let total = 0;
let last = null;
for (let i = 0; i < rounds; i++) {
  last = new Message(i, i & 1 ? "/a" : "/bc", i & 2 ? "GET" : "POST");
  total += last.url.length + last.emit("x");
}
console.log(total, last.describe(), Object.keys(last).join());
console.log(Object.create(Message.prototype).describe());
