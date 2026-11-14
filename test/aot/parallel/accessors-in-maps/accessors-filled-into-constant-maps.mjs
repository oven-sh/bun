var Scope = function Scope(flags) {
  this.flags = flags;
  this.names = [];
};
var Reader = function Reader(text) {
  this.text = text;
  this.position = 0;
  this.scopes = [];
  this.enter(1);
};
var accessors = { inFunction: { configurable: true }, depth: { configurable: true, enumerable: true }, current: { configurable: false }, mode: {} };
Reader.prototype.enter = function (flags) {
  this.scopes.push(new Scope(flags));
};
accessors.inFunction.get = function () {
  return (this.current.flags & 2) > 0;
};
accessors.depth.get = function () {
  return this.scopes.length;
};
accessors.current.get = function () {
  return this.scopes[this.scopes.length - 1];
};
accessors.mode.get = function () {
  return this._mode || "plain";
};
accessors.mode.set = function (mode) {
  this._mode = mode + "!";
};
Object.defineProperties(Reader.prototype, accessors);

function show(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return name + ":" + (descriptor ? `${typeof descriptor.get},${typeof descriptor.set},${descriptor.enumerable},${descriptor.configurable}` : "none");
}
for (const name of ["inFunction", "depth", "current", "mode", "missing"]) console.log(show(Reader.prototype, name));

function run(i) {
  const reader = new Reader("text" + i);
  const seen = [reader.inFunction, reader.depth, reader.mode];
  reader.enter(i & 3);
  if (i % 3 === 1) reader.mode = i;
  if (i % 4 === 2) reader.current.names.push("n" + i);
  seen.push(reader.inFunction, reader.depth, reader.current.names.length, reader.mode);
  try {
    "use strict";
    reader.depth = 9;
    seen.push("stored");
  } catch (error) {
    seen.push(error.constructor.name);
  }
  const names = [];
  for (const name in reader) names.push(name);
  return seen.join() + " " + names.join();
}
for (let round = 0; round < 3; round++) for (let i = 0; i < 12; i++) console.log(run(i));

Object.defineProperty(Reader.prototype, "depth", { get: () => "again", configurable: true });
console.log(new Reader("r").depth, run(5));
delete Reader.prototype.inFunction;
const late = new Reader("late");
late.mode = "own";
console.log("inFunction" in late);
console.log(late.mode, Object.keys(late).join(), run(1));

var escaping = { first: { configurable: true }, second: { configurable: true } };
var kept = escaping.second;
escaping.first.get = function () {
  return this.value + 1;
};
kept.get = function () {
  return this.value + 2;
};
var Escaping = function Escaping(value) {
  this.value = value;
};
Object.defineProperties(Escaping.prototype, escaping);
kept.get = function () {
  return "too late";
};
console.log(new Escaping(1).first, new Escaping(1).second, typeof escaping.first.get);

var twice = { value: { configurable: true } };
twice.value.get = function () {
  return "first";
};
twice.value.get = function () {
  return "second";
};
var Twice = function Twice() {
  this.kept = 1;
};
Object.defineProperties(Twice.prototype, twice);
console.log(new Twice().value, new Twice().kept);

var bare = { value: { configurable: true }, other: { configurable: true } };
bare.value.get = function () {
  return this.kept;
};
var Bare = function Bare() {
  this.kept = 2;
};
Object.defineProperties(Bare.prototype, bare);
console.log(new Bare().value, new Bare().other, "other" in new Bare());
for (let i = 0; i < 3; i++) {
  var inLoop = { value: { configurable: true } };
  inLoop.value.get = function () {
    return i;
  };
  var InLoop = function InLoop() {
    this.kept = i;
  };
  Object.defineProperties(InLoop.prototype, inLoop);
  console.log(new InLoop().value, new InLoop().kept);
}
