const events = require("node:events");
const http = require("node:http");
const seen = [];
const original = events.EventEmitter.prototype.on;
events.EventEmitter.prototype.on = function (type, fn) {
  seen.push(type);
  return original.call(this, type, fn);
};
events.EventEmitter.prototype.addListener = events.EventEmitter.prototype.on;
events.captureRejections = true;
http.Agent.defaultMaxSockets = 3;
const proto = http.Agent.prototype;
proto.mine = 1;
const a = http.globalAgent;
console.log(
  seen.join(),
  a.maxSockets,
  a.mine,
  Object.getPrototypeOf(a) === proto,
  Object.hasOwn(a, "on"),
  a.on === events.EventEmitter.prototype.on,
  a.listenerCount("free"),
  Object.keys(a).slice(0, 8).join(),
);
console.log(
  typeof a.emit,
  Object.hasOwn(a, "emit"),
  events.captureRejections,
  a.eventNames().join(),
  JSON.stringify(a.options),
);
