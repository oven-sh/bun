// A constructor stores, and reads, names that have a default on the prototype object: a value, an accessor, a read-only value, a default that comes or changes later.
"use strict";
const log = [];

function Message(url) {
  log.push("before " + this.upgrade + " " + this.count + " " + this.fixed);
  this.first = 1;
  this.upgrade = null;
  this.count = 2;
  this.url = url;
  try {
    this.fixed = 3;
  } catch (error) {
    log.push(error.constructor.name);
  }
  this.last = 4;
}
Message.prototype.upgrade = false;
Object.defineProperty(Message.prototype, "count", {
  get() {
    return this.hidden === undefined ? "none" : this.hidden;
  },
  set(value) {
    log.push("set " + value);
    this.hidden = value * 10;
  },
  configurable: true,
});
Object.defineProperty(Message.prototype, "fixed", { value: "fixed", writable: false, configurable: true });

function Reply(url) {
  Message.call(this, url);
  this.upgrade = true;
  this.extra = this.late;
}
Reply.prototype = Object.create(Message.prototype, { constructor: { value: Reply, writable: true, configurable: true } });

function describe(object) {
  return JSON.stringify(object) + " " + Object.keys(object).join() + " " + object.upgrade + " " + object.count + " " + object.fixed + " " + Object.hasOwn(object, "upgrade") + Object.hasOwn(object, "count") + Object.hasOwn(object, "fixed");
}

for (let round = 0; round < 3; ++round) {
  log.push(describe(new Message("a" + round)));
  log.push(describe(new Reply("b" + round)));
}

Reply.prototype.late = "late";
Message.prototype.first = "default of first";
Object.defineProperty(Message.prototype, "last", {
  set(value) {
    log.push("last " + value);
  },
  configurable: true,
});
Object.defineProperty(Message.prototype, "fixed", { value: "free", writable: true, configurable: true });
delete Message.prototype.count;
for (let round = 0; round < 2; ++round) {
  log.push(describe(new Message("c" + round)));
  log.push(describe(new Reply("d" + round)));
}

Object.defineProperty(Message.prototype, "upgrade", { value: "locked", writable: false, configurable: true });
for (const make of [() => new Message("e"), () => new Reply("f")]) {
  try {
    log.push(describe(make()));
  } catch (error) {
    log.push("threw " + error.constructor.name);
  }
}
console.log(log.join("\n"));
