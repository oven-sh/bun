// What packages write: constructor functions with methods on their prototypes, `module.exports`, `Object.defineProperty`, `arguments.length`, `f.call`, members of `process`, `require`, `globalThis`, `Buffer` and `Bun`.
"use strict";
var util = require("node:util");
var EventEmitter = require("node:events").EventEmitter;
var slice = Array.prototype.slice;
var hasOwn = Object.prototype.hasOwnProperty;
var toString = Object.prototype.toString;

function Route(path) {
  this.path = path;
  this.stack = [];
  this.methods = Object.create(null);
}
Route.prototype.handles = function handles(method) {
  return Boolean(this.methods[method.toLowerCase()]);
};
Route.prototype.all = function all() {
  var callbacks = slice.call(arguments);
  this.stack.push(callbacks.length);
  return this;
};
Route.create = function create(path) {
  return new Route(path);
};
Object.defineProperty(Route.prototype, "size", {
  configurable: true,
  get: function () {
    return this.stack.length;
  },
});

function Layer(path) {
  if (!(this instanceof Layer)) return new Layer(path);
  EventEmitter.call(this);
  this.path = path;
}
util.inherits(Layer, EventEmitter);
Layer.prototype.match = function match(path) {
  return path === this.path;
};

function Sub(path) {
  Route.call(this, path);
  this.extra = 1;
}
Sub.prototype = Object.create(Route.prototype);
Sub.prototype.constructor = Sub;
Object.setPrototypeOf(Sub, Route);

function countArguments() {
  return arguments.length + (arguments.length > 1 ? arguments[1] : 0);
}
function applies(f, self, list) {
  return f.apply(self, list) + f.call(self, 1, 2) + f.bind(self)(3, 4);
}
function owns(o, k) {
  return hasOwn.call(o, k) && Object.prototype.hasOwnProperty.call(o, "a") && Object.hasOwn(o, "a");
}
function kinds(v) {
  return (
    toString.call(v) +
    typeof v.length +
    Array.isArray(v) +
    Number.isInteger(v.length) +
    String.fromCharCode(65) +
    JSON.stringify(v) +
    Math.floor(1.5)
  );
}
function platform() {
  return process.platform === "win32" ? "w" : process.versions.bun ? "b" : "n";
}
function lengths(s, a) {
  return s.length + a.length + s.charCodeAt(0) + a.indexOf(1) + s.slice(1).length;
}
function mixin(a, b) {
  Object.keys(b).forEach(function (k) {
    a[k] = b[k];
  });
  return Object.assign(a, { z: 1 });
}
function symbols(o) {
  return typeof o[Symbol.iterator] + String(Symbol.asyncIterator) + (Symbol.toStringTag in o);
}
function errors() {
  var e = new Error("x");
  e.code = "E";
  e.status = 404;
  Error.captureStackTrace(e, errors);
  return e.message + e.code + e.status + e.name;
}
function promises(v) {
  return Promise.resolve(v)
    .then(function (x) {
      return x + 1;
    })
    .catch(function () {
      return 0;
    });
}
function lazy() {
  return require("node:path").join("a", "b") + require("node:os").EOL.length;
}
function resolves() {
  return typeof require.resolve + typeof require.cache + typeof module.id + typeof module.filename;
}
function globals() {
  return typeof globalThis.process + typeof globalThis.Bun + typeof global.setTimeout + typeof globalThis.notThere;
}
function buffers(b) {
  return Buffer.from("ab").length + Buffer.byteLength("abc") + Buffer.isBuffer(b) + b.toString("hex");
}
function bun() {
  return typeof Bun.serve + typeof Bun.version + Bun.inspect(1);
}
function statics() {
  return Number.MAX_SAFE_INTEGER + Math.PI + Number.EPSILON;
}
function proto(o) {
  return o.__proto__ === Object.prototype;
}
function consoles() {
  console.log("c");
}

module.exports = Route;
module.exports.Layer = Layer;
module.exports.default = Route;
exports = module.exports;
exports.Sub = Sub;
Object.defineProperty(exports, "__esModule", { value: true });

var r = Route.create("/a").all(1, 2);
console.log(
  r.handles("GET"),
  r.size,
  new Layer("/b").match("/b"),
  Layer("/c").path,
  new Sub("/d").extra,
  new Sub("/e").all().size,
  countArguments(1, 2),
  applies(
    function (a, b) {
      return a + b;
    },
    null,
    [1, 2],
  ),
  owns({ a: 1 }, "a"),
  kinds([1]),
  platform(),
  lengths("ab", [1]),
  JSON.stringify(mixin({}, { q: 1 })),
  symbols([]),
  errors(),
  lazy(),
  resolves(),
  globals(),
  buffers(Buffer.from("x")),
  bun(),
  statics(),
  proto({}),
  Object.keys(module.exports).join(),
);
consoles();
promises(1).then(console.log);
