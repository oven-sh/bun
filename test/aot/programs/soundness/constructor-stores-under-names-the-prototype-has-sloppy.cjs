// A store in a constructor under a name that the prototype has as a writable data property creates a property of the new object.
// Once the inherited property is read-only, frozen or an accessor, the same store creates nothing: it throws in strict code and does nothing in sloppy code.
var log = [];

function Dog(name) {
  this.name = name;
  this.tricks = 0;
}
Dog.prototype.speak = function () {
  return this.name + "!";
};
function Puppy(name) {
  Dog.call(this, name);
  this.age = 1;
}
Puppy.prototype = new Dog("prototype");
Puppy.prototype.constructor = Puppy;

function own(object) {
  return Object.keys(object).join(",");
}

var sum = 0;
var puppy;
for (var i = 0; i < 3000; i++) {
  puppy = new Puppy("p" + (i & 3));
  puppy.tricks += i & 1;
  sum += puppy.tricks + puppy.age;
}
log.push(sum + " " + own(puppy) + " " + puppy.speak() + " " + Puppy.prototype.name + " " + Puppy.prototype.tricks);

class Button {
  constructor(label) {
    this.label = label;
    this.press = this.press.bind(this);
  }
  press() {
    return "pressed " + this.label;
  }
}
var pressed = "";
for (var j = 0; j < 3000; j++) {
  var button = new Button(j);
  var press = button.press;
  if (j > 2997)
    pressed += press() + " " + Object.hasOwn(button, "press") + " ";
}
log.push(pressed + (Button.prototype.press === button.press));

function Guarded(value) {
  this.value = value;
  this.other = value + 1;
}
Guarded.prototype.value = "inherited";
function makeGuarded(count) {
  var last;
  try {
    for (var k = 0; k < count; k++)
      last = new Guarded(k);
  } catch (error) {
    return (error instanceof TypeError ? "TypeError" : "other error") + " in round " + k;
  }
  return own(last) + " " + last.value + " " + last.other;
}
log.push(makeGuarded(2000));
Object.defineProperty(Guarded.prototype, "value", { writable: false });
log.push(makeGuarded(2000));
Object.defineProperty(Guarded.prototype, "value", { writable: true });
log.push(makeGuarded(2000));
var stored = [];
Object.defineProperty(Guarded.prototype, "value", {
  set: function (value) {
    if (value > 1997)
      stored.push(value);
  },
  get: function () {
    return "from getter";
  },
});
log.push(makeGuarded(2000) + " " + stored.join(","));

function Frozen(size) {
  this.size = size;
}
Frozen.prototype.size = -1;
function makeFrozen(count) {
  var last;
  try {
    for (var k = 0; k < count; k++)
      last = new Frozen(k);
  } catch (error) {
    return (error instanceof TypeError ? "TypeError" : "other error") + " in round " + k;
  }
  return "[" + own(last) + "] " + last.size;
}
log.push(makeFrozen(2000));
Object.freeze(Frozen.prototype);
log.push(makeFrozen(2000));

console.log(log.join("\n"));
