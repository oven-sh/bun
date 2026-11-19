var EventEmitter = require("events");
var Meter = require("./meter");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var heard = [];
function listen(value, count) {
  heard.push(typeof value + " " + count + " " + (this instanceof Meter));
}
var meter = new Meter("honest");
meter.on("reading", listen);
for (var i = 0; i < 2000; i++) meter.read(i % 7);
console.log("honest", meter.total, meter.average(), heard.length, heard[1999]);

var values = { text: "5", nothing: undefined, none: null, object: { valueOf: function () { return 5; } }, list: [5], big: 5n, yes: true, notANumber: NaN };
Object.keys(values).forEach(function (name) {
  var fresh = new Meter(name);
  heard.length = 0;
  fresh.on("reading", listen);
  attempt("read(1), read(" + name + ")", function () {
    return [fresh.read(1), fresh.read(values[name]), fresh.total, fresh.average(), heard.join("; ")];
  });
});
attempt("is an emitter", function () { return [meter instanceof EventEmitter, Meter.super_ === EventEmitter, Object.keys(meter).indexOf("name") !== -1]; });
attempt("made without new", function () { return Meter("no new"); });
attempt("the method on a stranger", function () { return Meter.prototype.read.call({ total: 0, readings: [], emit: function () { return "own emit"; } }, 2); });
attempt("the method on a stranger without emit", function () { return Meter.prototype.read.call({ total: 0, readings: [] }, 2); });
attempt("a listener that is no function", function () { return new Meter("odd").on("reading", "not a function"); });
attempt("readings replaced by a text", function () {
  var odd = new Meter("odd");
  odd.readings = "text";
  return odd.read(1);
});
attempt("emit replaced on the instance", function () {
  var odd = new Meter("odd");
  odd.emit = function (name, value) { return name + value; };
  return odd.read(1);
});
attempt("a listener that throws", function () {
  var odd = new Meter("odd");
  odd.on("reading", function () { throw new RangeError("too much"); });
  return odd.read(1);
});
attempt("an error event that nobody hears", function () { return new Meter("odd").emit("error", new SyntaxError("unheard")); });
