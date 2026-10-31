// Reads by name and by symbol of fields that a store of undefined creates and that have no storage then: never created, created with undefined, filled, deleted, redefined,
// while the prototype has nothing of the name, gets undefined, another value, a getter, and loses it again. Every read runs often enough to be answered by a cache.
var unseen = new Function("x", "return x");
var kMark = Symbol("mark");

function Base() {}
Base.prototype.origin = "base";
unseen(Base);

function Message(id) {
  this.id = id;
}
Object.setPrototypeOf(Message.prototype, Base.prototype);
Message.prototype.kind = "message";
unseen(Message);

function fillOthers(message, value) {
  message.first = value;
  message.second = value;
  message.third = value;
  message.fourth = value;
  message.fifth = value;
  message.sixth = value;
  message.seventh = value;
  message.eighth = value;
  message.ninth = value;
  message.tenth = value;
  message.eleventh = value;
  message.twelfth = value;
  message.thirteenth = value;
  message.fourteenth = value;
  message.fifteenth = value;
  message.sixteenth = value;
}

function setStatus(message, value) {
  message.status = value;
  message[kMark] = value;
}

function listStatus(message) {
  message.status = undefined;
  message[kMark] = undefined;
}

function readStatus(message) {
  return message.status;
}

function readMark(message) {
  return message[kMark];
}

// The fields that are read and filled most stay in the cell. The two that this is about are to lie outside of it.
function countOthers(message) {
  var count = 0;
  for (var round = 0; round < 3; round++) {
    for (var inner = 0; inner < 3; inner++) {
      fillOthers(message, message.first);
      if (message.first) count++;
      if (message.second) count++;
      if (message.third) count++;
      if (message.fourth) count++;
      if (message.fifth) count++;
      if (message.sixth) count++;
      if (message.seventh) count++;
      if (message.eighth) count++;
      if (message.ninth) count++;
      if (message.tenth) count++;
      if (message.eleventh) count++;
      if (message.twelfth) count++;
      if (message.thirteenth) count++;
      if (message.fourteenth) count++;
      if (message.fifteenth) count++;
      if (message.sixteenth) count++;
    }
  }
  return count;
}

var readers = unseen({ readStatus, readMark });

function describe(message) {
  var byName;
  var bySymbol;
  for (var round = 0; round < 60; round++) {
    byName = readers.readStatus(message);
    bySymbol = readers.readMark(message);
  }
  return [
    String(byName),
    String(bySymbol),
    "status" in message,
    kMark in message,
    Object.prototype.hasOwnProperty.call(message, "status"),
    Object.prototype.hasOwnProperty.call(message, kMark),
    Object.keys(message).indexOf("status"),
    Object.getOwnPropertySymbols(message).length,
  ].join(" ");
}

function make() {
  var never = unseen(new Message(1));
  var listed = unseen(new Message(2));
  listStatus(listed);
  var filled = unseen(new Message(3));
  setStatus(filled, "filled");
  var emptied = unseen(new Message(4));
  setStatus(emptied, "once");
  listStatus(emptied);
  var deleted = unseen(new Message(5));
  listStatus(deleted);
  delete deleted.status;
  delete deleted[kMark];
  var besideOthers = unseen(new Message(6));
  fillOthers(besideOthers, 1);
  besideOthers.id += countOthers(besideOthers);
  fillOthers(besideOthers, "text");
  besideOthers.id += countOthers(besideOthers);
  fillOthers(besideOthers, 0.5);
  besideOthers.id += countOthers(besideOthers);
  fillOthers(besideOthers, besideOthers);
  besideOthers.id += countOthers(besideOthers);
  var listedBesideOthers = unseen(new Message(7));
  listStatus(listedBesideOthers);
  fillOthers(listedBesideOthers, undefined);
  var withExtraProperty = unseen(new Message(8));
  withExtraProperty["made up " + withExtraProperty.id] = 1;
  var listedWithExtraProperty = unseen(new Message(9));
  listedWithExtraProperty["made up " + listedWithExtraProperty.id] = 1;
  setStatus(listedWithExtraProperty, undefined);
  var redefined = unseen(new Message(10));
  listStatus(redefined);
  Object.defineProperty(redefined, "status", { value: undefined, enumerable: false, writable: false, configurable: true });
  Object.defineProperty(redefined, kMark, { get() { return "own getter"; }, configurable: true });
  var frozen = unseen(new Message(11));
  listStatus(frozen);
  Object.freeze(frozen);
  var heir = unseen(Object.create(listed));
  return { never, listed, filled, emptied, deleted, besideOthers, listedBesideOthers, withExtraProperty, listedWithExtraProperty, redefined, frozen, heir };
}

function report(title) {
  var messages = make();
  var lines = [title];
  for (var name in messages) lines.push("  " + name + ": " + describe(messages[name]));
  for (var name in kept) lines.push("  kept " + name + ": " + describe(kept[name]));
  console.log(lines.join("\n"));
}

var kept = make();
report("nothing above");

Message.prototype.status = undefined;
Message.prototype[kMark] = undefined;
report("undefined above");

Message.prototype.status = 5;
Message.prototype[kMark] = null;
report("a value above");

Message.prototype.status = undefined;
Message.prototype[kMark] = undefined;
report("undefined above again");

function accessorFor(key, title) {
  return {
    get() { return title + this.id; },
    set(value) { Object.defineProperty(this, key, { value, writable: true, enumerable: true, configurable: true }); },
    configurable: true,
  };
}
Object.defineProperty(Message.prototype, "status", accessorFor("status", "getter of "));
Object.defineProperty(Message.prototype, kMark, accessorFor(kMark, "symbol getter of "));
report("a getter above");

delete Message.prototype.status;
delete Message.prototype[kMark];
report("nothing above again");

Base.prototype.status = "from Base.prototype";
Base.prototype[kMark] = "symbol from Base.prototype";
report("a value far above");

Base.prototype.status = undefined;
Base.prototype[kMark] = undefined;
report("undefined far above");

delete Base.prototype.status;
delete Base.prototype[kMark];
report("nothing above at the end");

Object.setPrototypeOf(Message.prototype, { status: "from a new parent", [kMark]: 0 });
report("a new parent");
