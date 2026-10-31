// `(function (E) { E[E["A"] = 0] = "A"; })(E = exports.E || (exports.E = {}));`: a read of E.A is 0 only where nobody can see the object before the function has stored it.
const lines = [];
const say = (...values) => lines.push(values.map(String).join(" "));

// What tsc 3.9 to 4.x prints for an exported enum in a CommonJS file.
exports.Color = void 0;
var Color;
(function (Color) {
  Color[Color["Red"] = 0] = "Red";
  Color[Color["Green"] = 1] = "Green";
  Color["Blue"] = "blue";
})(Color = exports.Color || (exports.Color = {}));
function nameOf(color) {
  switch (color) {
    case Color.Red: return "red";
    case Color.Green: return "green";
    case Color.Blue: return "blue";
  }
  return "none";
}
say(nameOf(0), nameOf(1), nameOf("blue"), nameOf(2), Color[0], Color[1], exports.Color === Color, exports.Color.Green);

// The same where the property of exports holds an object already.
exports.Taken = { Old: 9, First: 5 };
var Taken;
(function (Taken) {
  Taken["First"] = 0;
  Taken["Second"] = 1;
})(Taken = exports.Taken || (exports.Taken = {}));
function readTaken() {
  say(Taken.Old, Taken.First, Taken.Second);
}
readTaken();

// The function hands the object back.
var Returned = function (Returned) {
  Returned[Returned["A"] = 0] = "A";
  Returned[Returned["B"] = 1] = "B";
  return Returned;
}({});
function readReturned() {
  say(Returned.A, Returned.B, Returned[1]);
}
readReturned();

// It hands another object back.
var Other = function (given) {
  given.a = 1;
  return { a: 2 };
}({});
function readOther() {
  say(Other.a);
}
readOther();

// It reads a member ahead of its store.
var Ahead;
(function (Ahead) {
  Ahead.first = 1;
  Ahead.copy = Ahead.last;
  Ahead.last = 3;
})(Ahead || (Ahead = {}));
function readAhead() {
  say(Ahead.first, Ahead.copy, Ahead.last);
}
readAhead();

// It calls a function that looks.
var Watched;
function look() {
  return Watched === undefined ? "nothing yet" : Watched.one + "|" + Watched.two;
}
(function (given) {
  given.one = 1;
  say(look());
  given.two = 2;
})(Watched || (Watched = {}));
say(look());

// It throws halfway.
var Broken;
function readBroken() {
  say(Broken.one, Broken.two);
}
try {
  (function (given) {
    given.one = 1;
    null.x;
    given.two = 2;
  })(Broken || (Broken = {}));
} catch (error) {
  say(error.constructor.name);
}
readBroken();

// Two declarations of one enum, with a look between them.
var Merged;
function readMerged() {
  say(Merged.A, Merged.B);
}
(function (Merged) {
  Merged[Merged["A"] = 0] = "A";
})(Merged || (Merged = {}));
readMerged();
(function (Merged) {
  Merged[Merged["B"] = 1] = "B";
})(Merged || (Merged = {}));
readMerged();

// One function fills two objects, and one of them again later.
function fill(target) {
  target.x = 1;
  target.y = 2;
}
const FilledOne = {};
fill(FilledOne);
const FilledTwo = {};
fill(FilledTwo);
function readFilled() {
  say(FilledOne.x, FilledOne.y, FilledTwo.x, FilledTwo.y);
}
readFilled();
FilledTwo.y = 5;
readFilled();
fill(FilledTwo);
readFilled();

// The value comes from the caller.
function fillWith(target, value) {
  target.v = value;
}
const WithOne = {};
fillWith(WithOne, 1);
const WithTwo = {};
fillWith(WithTwo, 2);
function readWith() {
  say(WithOne.v, WithTwo.v);
}
readWith();

// The object goes in by `arguments`, by a rest parameter, as `this`, and twice.
const ByArguments = {};
(function () {
  arguments[0].a = 1;
})(ByArguments);
const ByRest = {};
(function (...rest) {
  rest[0].a = 2;
})(ByRest);
const ByThis = {};
(function () {
  this.a = 3;
}).call(ByThis);
const Doubled = {};
(function (left, right) {
  left.a = 4;
  right.b = left.a + 1;
})(Doubled, Doubled);
function readWays() {
  say(ByArguments.a, ByRest.a, ByThis.a, Doubled.a, Doubled.b);
}
readWays();

// A function that calls itself.
const Deep = {};
(function again(target, depth) {
  target.depth = 7;
  if (depth) again(target, depth - 1);
  target.end = 8;
})(Deep, 2);
function readDeep() {
  say(Deep.depth, Deep.end);
}
readDeep();

// An async function and a generator stop on their way.
const Awaited = {};
function readAwaited() {
  return Awaited.before + "|" + Awaited.after;
}
const done = (async function (target) {
  target.before = 1;
  await null;
  target.after = 2;
})(Awaited);
say(readAwaited());
const Yielded = {};
const steps = (function* (target) {
  target.before = 1;
  yield;
  target.after = 2;
})(Yielded);
function readYielded() {
  return Yielded.before + "|" + Yielded.after;
}
say(readYielded());
steps.next();
say(readYielded());
steps.next();
say(readYielded());

// A namespace: functions among the members, and a member made from another.
var Space;
(function (Space) {
  Space.limit = 10;
  function twice(n) {
    return n * 2;
  }
  Space.twice = twice;
  Space.double = Space.limit * 2;
  Space.name = "space";
})(Space || (Space = {}));
function readSpace() {
  say(Space.limit, Space.twice(4), Space.double, Space.name);
}
readSpace();

done.then(() => {
  say(readAwaited());
  console.log(lines.join("\n"));
});
