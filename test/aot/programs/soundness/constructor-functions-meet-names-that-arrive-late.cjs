// The stores in a constructor function create the fields of the new object until a setter, a read-only property or another parent arrives on the prototype chain.
// The functions are handed to a proxy, so nothing about them is proven and every fast path rests on a test.
var outOfSight = new Proxy({}, {});
var log = [];

function own(object) {
  return Object.keys(object).join(",");
}

function repeat(make, count) {
  var last;
  for (var i = 0; i < count; i++)
    last = make(i);
  return last;
}

function report(label, object) {
  log.push(label + ": [" + own(object) + "] " + object.first + " " + object.second);
}

// The prototype object that the function was created with.
function Plain(value) {
  this.first = value;
  this.second = value + 1;
}
Plain.prototype.sum = function () {
  return this.first + this.second;
};
outOfSight.value = Plain;
function makePlain(value) {
  return new Plain(value);
}
report("plain", repeat(makePlain, 2000));
var seen = [];
Object.defineProperty(Plain.prototype, "second", {
  set: function (value) {
    if (value > 1999)
      seen.push(value);
  },
  get: function () {
    return "getter";
  },
  configurable: true,
});
report("setter on the prototype", repeat(makePlain, 2000));
log.push("setter saw " + seen.join(","));
delete Plain.prototype.second;
report("setter deleted", repeat(makePlain, 2000));
Object.defineProperty(Plain.prototype, "first", { value: "fixed", writable: false, configurable: true });
report("read-only on the prototype", repeat(makePlain, 2000));
delete Plain.prototype.first;
report("read-only deleted", repeat(makePlain, 2000));

// A literal stored as the prototype before the first construction.
function Literal(value) {
  this.first = value;
  this.second = value + 1;
}
Literal.prototype = {
  constructor: Literal,
  sum: function () {
    return this.first + this.second;
  },
};
outOfSight.value = Literal;
function makeLiteral(value) {
  return new Literal(value);
}
report("literal", repeat(makeLiteral, 2000));
log.push("literal sum " + makeLiteral(4).sum() + " " + (makeLiteral(4) instanceof Literal));
Object.defineProperty(Literal.prototype, "first", {
  set: function () {},
  get: function () {
    return "literal getter";
  },
  configurable: true,
});
report("setter on the literal", repeat(makeLiteral, 2000));

// Another parent for the prototype object.
function Reparented(value) {
  this.first = value;
  this.second = value + 1;
}
outOfSight.value = Reparented;
function makeReparented(value) {
  return new Reparented(value);
}
report("before the parent changes", repeat(makeReparented, 2000));
Object.setPrototypeOf(Reparented.prototype, {
  set second(value) {},
  get second() {
    return "from the parent";
  },
});
report("after the parent changed", repeat(makeReparented, 2000));

// A name that arrives on the parent class.
function Base(value) {
  this.first = value;
}
function Derived(value) {
  Base.call(this, value);
  this.second = value + 1;
}
Derived.prototype = Object.create(Base.prototype);
Derived.prototype.constructor = Derived;
outOfSight.value = [Base, Derived];
function makeDerived(value) {
  return new Derived(value);
}
report("derived", repeat(makeDerived, 2000));
Object.defineProperty(Base.prototype, "second", {
  set: function () {},
  get: function () {
    return "from the base";
  },
  configurable: true,
});
report("setter on the base", repeat(makeDerived, 2000));
log.push("instances: " + (makeDerived(1) instanceof Base) + " " + (makeDerived(1) instanceof Derived) + " " + (new Base(1) instanceof Derived));

// A frozen instance and an instance that may not grow are no concern of later constructions.
Object.freeze(makePlain(1));
Object.preventExtensions(makePlain(2));
report("after freezing an instance", repeat(makePlain, 2000));

// Methods are replaced.
function Speaker(word) {
  this.word = word;
}
Speaker.prototype.speak = function () {
  return this.word + "!";
};
outOfSight.value = Speaker;
function speakMany(count) {
  var text = "";
  for (var i = 0; i < count; i++) {
    var said = new Speaker("w" + (i & 1)).speak();
    if (i > count - 3)
      text += said + " ";
  }
  return text;
}
log.push(speakMany(2000));
Speaker.prototype.speak = function () {
  return this.word + "?";
};
log.push(speakMany(2000));
var quiet = new Speaker("own");
quiet.speak = function () {
  return "quiet";
};
log.push(quiet.speak() + " " + speakMany(2000));
delete Speaker.prototype.speak;
try {
  speakMany(3);
} catch (error) {
  log.push(error instanceof TypeError ? "TypeError" : "other error");
}

console.log(log.join("\n"));
