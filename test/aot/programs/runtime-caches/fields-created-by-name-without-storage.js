// Stores by name and by symbol that create fields for which the object has no storage yet, or too little: in ascending and descending order, with values of every kind,
// on objects that are not extensible, sealed or frozen, and below a prototype that gets a setter or a read-only property of the name.
var unseen = new Function("x", "return x");
var kMark = Symbol("mark");
var kCount = Symbol("count");

function Message(id) {
  this.id = id;
}
Message.prototype.describe = function () {
  var parts = [];
  for (var key in this) {
    if (typeof this[key] !== "function") parts.push(key + "=" + String(this[key]));
  }
  return parts.join(",") + "|" + String(this[kMark]) + "|" + String(this[kCount]);
};
unseen(Message);

function fillAscending(message, value) {
  message.first = value;
  message.second = value;
  message.third = value;
  message[kMark] = value;
  message.fourth = value;
  message.fifth = value;
  message.sixth = value;
  message.seventh = value;
  message.eighth = value;
  message.ninth = value;
  message.tenth = value;
  message.eleventh = value;
  message.twelfth = value;
  message[kCount] = value;
  message.thirteenth = value;
  message.fourteenth = value;
  message.fifteenth = value;
  message.sixteenth = value;
}

function fillDescending(message, value) {
  message.sixteenth = value;
  message.fifteenth = value;
  message.fourteenth = value;
  message.thirteenth = value;
  message.twelfth = value;
  message[kCount] = value;
  message.eleventh = value;
  message.tenth = value;
  message.ninth = value;
  message.eighth = value;
  message.seventh = value;
  message.sixth = value;
  message.fifth = value;
  message.fourth = value;
  message.third = value;
  message[kMark] = value;
  message.second = value;
  message.first = value;
}

function fillOne(message, value) {
  message.fifteenth = value;
}

var values = [1, -1, 0.5, 1e300, true, false, undefined, null, "", "text", kMark, 10n, { toString() { return "object"; } }, [1, 2], function named() {}.name];
var lines = [];
for (var round = 0; round < 40; round++) {
  var value = values[round % values.length];
  var ascending = unseen(new Message(round));
  fillAscending(ascending, value);
  fillAscending(ascending, round);
  var descending = unseen(new Message(round));
  fillDescending(descending, value);
  var single = unseen(new Message(round));
  fillOne(single, value);
  fillOne(single, values[(round + 1) % values.length]);
  if (round % 13 === 0 || round > 36) lines.push(ascending.describe(), descending.describe(), single.describe());
}
console.log(lines.join("\n"));

function attempt(name, prepare) {
  "use strict";
  var message = unseen(new Message(0));
  fillOne(message, 1);
  prepare(message);
  var outcome;
  try {
    fillAscending(message, 2);
    outcome = "stored";
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log(name, outcome, message.describe(), Object.keys(message).length);
}
function fillStrictly(message, value) {
  "use strict";
  message.first = value;
  message.sixteenth = value;
}
for (var repeat = 0; repeat < 3; repeat++) {
  attempt("extensible", function () {});
  attempt("not extensible", Object.preventExtensions);
  attempt("sealed", Object.seal);
  attempt("frozen", Object.freeze);
}
for (var prepare of [Object.preventExtensions, Object.seal, Object.freeze]) {
  var strict = unseen(new Message(1));
  prepare(strict);
  try {
    fillStrictly(strict, 1);
    console.log("stored");
  } catch (error) {
    console.log(error.constructor.name, strict.describe());
  }
}

var seen = [];
Object.defineProperty(Message.prototype, "third", { set(value) { seen.push(value); }, get() { return "inherited"; }, configurable: true, enumerable: true });
Object.defineProperty(Message.prototype, "fourteenth", { value: "fixed", writable: false, configurable: true, enumerable: true });
var below = unseen(new Message(2));
for (var fill of [fillAscending, fillDescending]) {
  try {
    fill(below, 7);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
console.log(below.describe(), seen.join(), Object.keys(below).join());
delete Message.prototype.third;
delete Message.prototype.fourteenth;
var after = unseen(new Message(3));
fillDescending(after, 9);
console.log(after.describe(), Object.keys(after).join());
