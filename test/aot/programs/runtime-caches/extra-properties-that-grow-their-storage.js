// Stores by name and by symbol that add properties the object's layout has no room for, so many that their storage
// has to grow several times; and the neighbors where the same store must not add: an object that is not extensible,
// a setter or a read-only property that the prototype gets later.
"use strict";
const outOfSight = new Proxy({}, {});

function Message(id) {
  this.id = id;
}
outOfSight.value = Message;

const first = Symbol("first");
const second = Symbol("second");

function decorate(message, step) {
  message.a1 = step;
  message.a2 = step + 1;
  message.a3 = step + 2;
  message.a4 = step + 3;
  message.a5 = step + 4;
  message.a6 = step + 5;
  message[first] = "first";
  message.a7 = step + 6;
  message.a8 = step + 7;
  message.a9 = step + 8;
  message.a10 = step + 9;
  message.a11 = step + 10;
  message[second] = "second";
  message.a12 = step + 11;
  message.a13 = step + 12;
  message.a14 = step + 13;
  message.a15 = step + 14;
  message.a16 = step + 15;
  message.a17 = step + 16;
  message.a18 = step + 17;
  message.a19 = step + 18;
  message.a20 = step + 19;
}
outOfSight.decorate = decorate;

function describe(message) {
  let sum = 0;
  for (const key of Object.keys(message)) sum += message[key];
  return Object.keys(message).join(",") + " sum " + sum + " " + String(message[first]) + " " + String(message[second]);
}

function attempt(message, step) {
  try {
    outOfSight.decorate(message, step);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}

const seen = new Map();
function note(line) {
  seen.set(line, (seen.get(line) ?? 0) + 1);
}

for (let round = 0; round < 100; round++) {
  const plain = new outOfSight.value(1);
  note("plain " + attempt(plain, 1) + " " + describe(plain));

  const withIndexes = new outOfSight.value(1);
  withIndexes[JSON.parse("3")] = 30;
  withIndexes[JSON.parse("0")] = 10;
  note("indexes " + attempt(withIndexes, 1) + " " + describe(withIndexes));

  const closed = new outOfSight.value(1);
  closed.a1 = 0;
  closed.a2 = 0;
  Object.preventExtensions(closed);
  note("closed " + attempt(closed, 1) + " " + describe(closed));

  const twice = new outOfSight.value(1);
  attempt(twice, 1);
  note("twice " + attempt(twice, 2) + " " + describe(twice));
}
for (const [line, count] of [...seen].sort()) console.log(count, line);

let calls = 0;
Object.defineProperty(Message.prototype, "a7", { configurable: true, set(value) { calls += value; } });
const belowSetter = new outOfSight.value(1);
console.log("setter", attempt(belowSetter, 1), calls, describe(belowSetter));

Object.defineProperty(Message.prototype, "a7", { configurable: true, writable: false, value: 70 });
const belowReadOnly = new outOfSight.value(1);
console.log("read-only", attempt(belowReadOnly, 1), describe(belowReadOnly), belowReadOnly.a7);

delete Message.prototype.a7;
const again = new outOfSight.value(1);
console.log("again", attempt(again, 1), describe(again));

Object.defineProperty(Message.prototype, second, { configurable: true, set(value) { calls += 1000; } });
const belowSymbolSetter = new outOfSight.value(1);
console.log("symbol setter", attempt(belowSymbolSetter, 1), calls, describe(belowSymbolSetter));
