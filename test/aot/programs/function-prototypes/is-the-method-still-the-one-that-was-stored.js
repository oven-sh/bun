// `stream.emit === emit`: a library asks whether a method is still its own. Where the program makes one closure of a function, two values that are closures of it are one object.
// Where it makes two, in a loop, by a second call or by recursion, they are two objects, whatever their function.
"use strict";
const log = [];
function Stream(name) {
  this.name = name;
}
const emit = function emit(x) {
  return this.name + x;
};
const other = function other(x) {
  return this.name + "!" + x;
};
Stream.prototype.emit = emit;
function Heir(name) {
  Stream.call(this, name);
}
Object.setPrototypeOf(Heir.prototype, Stream.prototype);
function isOurs(stream) {
  return stream.emit === emit;
}
function isNotOurs(stream) {
  return stream.emit !== emit;
}
function round(title) {
  const stream = new Stream("s");
  const heir = new Heir("h");
  for (let i = 0; i < 3; i++) log.push(title + ": " + isOurs(stream) + " " + isNotOurs(stream) + " " + isOurs(heir) + " " + isNotOurs(heir) + " " + stream.emit(i) + " " + heir.emit(i));
  heir.emit = other;
  log.push(title + ", an own property: " + isOurs(heir) + " " + isNotOurs(heir));
  heir.emit = emit;
  log.push(title + ", the same function as an own property: " + isOurs(heir) + " " + isNotOurs(heir));
}
round("at first");
Stream.prototype.emit = other;
round("another function");
Stream.prototype.emit = emit;
round("the first again");
Heir.prototype.emit = other;
round("hidden in the heir");
delete Heir.prototype.emit;
round("no longer hidden");

function make() {
  return function made() {
    return 1;
  };
}
const first = make();
const second = make();
log.push("made by two calls: " + (first === second) + " " + (first === first) + " " + (first !== second));

const inLoop = [];
for (let i = 0; i < 2; i++) inLoop.push(function looped() {});
log.push("made in a loop: " + (inLoop[0] === inLoop[1]) + " " + (inLoop[0] === inLoop[0]));

function nest(depth, list) {
  list.push(function nested() {});
  if (depth) nest(depth - 1, list);
  return list;
}
const nested = nest(1, []);
log.push("made by recursion: " + (nested[0] === nested[1]));

function once() {
  return function madeOnce() {};
}
const onlyOne = once();
const alias = onlyOne;
log.push("made by one call: " + (onlyOne === alias) + " " + (onlyOne !== alias));

let either;
if (log.length > 1) either = function chosen() {};
else either = function chosen() {};
const kept = either;
log.push("one of two texts: " + (kept === either));

class Reader {
  read() {}
}
const read = Reader.prototype.read;
log.push("a method of a class: " + (new Reader().read === read) + " " + (Reader.prototype.read !== read));
function classes() {
  return class {
    run() {}
  };
}
log.push("a class made twice: " + (classes().prototype.run === classes().prototype.run));

const arrow = () => 1;
const generator = function* () {};
const asynchronous = async function () {};
log.push("other kinds: " + [arrow === arrow, generator === generator, asynchronous === asynchronous, arrow === generator].join());
const bound = emit.bind(null);
log.push("bound: " + (bound === emit) + " " + (emit.bind(null) === bound));
console.log(log.join("\n"));
