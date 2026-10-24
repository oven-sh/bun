var util = require("util");
var EventEmitter = require("events");

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function HttpError(status, message) {
  Error.call(this, message);
  this.name = "HttpError";
  this.status = status;
  this.message = message;
}
HttpError.prototype = Object.create(Error.prototype);
HttpError.prototype.constructor = HttpError;
HttpError.prototype.isServerError = function () {
  return this.status >= 500;
};

function CapturedError(message) {
  if (!(this instanceof CapturedError)) return new CapturedError(message);
  Error.captureStackTrace(this, CapturedError);
  this.message = message;
}
util.inherits(CapturedError, Error);
CapturedError.prototype.name = "CapturedError";

function WrappedError(message) {
  var inner = Error.call(this, message);
  this.inner = inner;
  this.sameAsThis = inner === this;
}
WrappedError.prototype = Object.create(Error.prototype, { constructor: { value: WrappedError } });

class ModernError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ModernError";
    this.status = status;
  }
  isServerError() {
    return this.status >= 500;
  }
}

function statusOf(error) {
  return error.status;
}

function messageOf(error) {
  return error.message;
}

function isServerError(error) {
  return error.isServerError();
}

function catchIt(make) {
  try {
    throw make();
  } catch (error) {
    return [error instanceof Error, error.name, messageOf(error), String(error), Object.prototype.toString.call(error), typeof error.stack];
  }
}

var count = 0;
for (var i = 0; i < 2000; i++) {
  var honest = i % 2 ? new HttpError(400 + (i % 200), "m") : new ModernError(400 + (i % 200), "m");
  if (isServerError(honest) && statusOf(honest) >= 500 && messageOf(honest) === "m") count++;
}
console.log("2000 honest errors", count);

attempt("HttpError", function () { return catchIt(function () { return new HttpError(500, "broken"); }); });
attempt("HttpError keys", function () { return Object.keys(new HttpError(500, "broken")); });
attempt("CapturedError with new", function () { return catchIt(function () { return new CapturedError("caught"); }); });
attempt("CapturedError without new", function () { return catchIt(function () { return CapturedError("caught"); }); });
attempt("CapturedError keys", function () { return Object.keys(new CapturedError("caught")); });
attempt("WrappedError", function () { var error = new WrappedError("wrapped"); return [error.sameAsThis, error.inner instanceof Error, error.inner.message, messageOf(error), Object.hasOwn(error, "message")]; });
attempt("ModernError", function () { return catchIt(function () { return new ModernError(500, "modern"); }); });
attempt("ModernError keys", function () { return Object.keys(new ModernError(500, "modern")); });
attempt("util.types.isNativeError", function () { return [util.types.isNativeError(new HttpError(1, "a")), util.types.isNativeError(new ModernError(1, "a")), util.types.isNativeError(new WrappedError("a").inner)]; });

[
  ["a plain Error", function () { return new Error("plain"); }],
  ["a TypeError with a status", function () { return Object.assign(new TypeError("typed"), { status: 503 }); }],
  ["a literal", function () { return { status: 500, message: "literal", isServerError: function () { return "a literal says so"; } }; }],
  ["a literal under HttpError.prototype", function () { return { __proto__: HttpError.prototype, status: "500" }; }],
  ["an HttpError without arguments", function () { return new HttpError(); }],
  ["an HttpError whose message is a getter", function () { return Object.defineProperty(new HttpError(500, "x"), "message", { get: function () { return "from a getter"; } }); }],
  ["a string", function () { return "error"; }],
  ["null", function () { return null; }],
].forEach(function (pair) {
  attempt(pair[0] + ": status", function () { return statusOf(pair[1]()); });
  attempt(pair[0] + ": message", function () { return messageOf(pair[1]()); });
  attempt(pair[0] + ": isServerError()", function () { return isServerError(pair[1]()); });
});

function Door(name) {
  EventEmitter.call(this);
  this.name = name;
  this.opened = 0;
}
util.inherits(Door, EventEmitter);
Door.prototype.open = function () {
  this.opened++;
  return this.emit("open", this.name, this.opened);
};

function ForgetfulDoor(name) {
  this.name = name;
  this.opened = 0;
}
ForgetfulDoor.prototype = Object.create(EventEmitter.prototype);
ForgetfulDoor.prototype.open = Door.prototype.open;

function openDoor(door) {
  return door.open();
}

var heard = [];
var door = new Door("front");
door.on("open", function (name, times) { if (times < 3 || times > 1999) heard.push(name + " " + times + " " + (this === door)); });
for (var j = 0; j < 2000; j++) openDoor(door);
attempt("2000 honest openings", function () { return heard.splice(0); });
attempt("a door nobody listens to", function () { return openDoor(new Door("back")); });
attempt("instanceof", function () { return [door instanceof Door, door instanceof EventEmitter, Door.super_ === EventEmitter]; });
attempt("own names that do not start with an underscore", function () { return Object.keys(door).filter(function (name) { return name[0] !== "_"; }); });
attempt("a door that never called its parent", function () { var forgetful = new ForgetfulDoor("side"); forgetful.on("open", function (name) { heard.push("heard " + name); }); return [openDoor(forgetful), heard.splice(0)]; });
attempt("two such doors do not share listeners", function () { var a = new ForgetfulDoor("a"); var b = new ForgetfulDoor("b"); a.on("open", function () { heard.push("a's listener"); }); return [openDoor(b), openDoor(a), heard.splice(0)]; });
attempt("a literal with its own emit", function () { return Door.prototype.open.call({ name: "literal", opened: "0", emit: function (event, name, times) { return [event, name, times]; } }); });
attempt("a literal without emit", function () { return Door.prototype.open.call({ name: "literal", opened: 0 }); });
attempt("a door whose emit was shadowed", function () { var shadowed = new Door("shadowed"); shadowed.emit = function () { return "own emit"; }; return openDoor(shadowed); });
attempt("an error event nobody listens to", function () { return new Door("angry").emit("error", new HttpError(500, "unheard")); });
