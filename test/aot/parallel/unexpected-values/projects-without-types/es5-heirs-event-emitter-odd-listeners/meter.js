var EventEmitter = require("events");
var util = require("util");

function Meter(name) {
  EventEmitter.call(this);
  this.name = name;
  this.total = 0;
  this.readings = [];
}
util.inherits(Meter, EventEmitter);
Meter.prototype.read = function (value) {
  this.total += value;
  this.readings.push(value);
  return this.emit("reading", value, this.readings.length);
};
Meter.prototype.average = function () {
  return this.total / this.readings.length;
};
module.exports = Meter;
