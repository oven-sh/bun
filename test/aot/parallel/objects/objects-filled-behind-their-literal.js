// Objects that the body of a file makes with `{}` and fills in the statements behind it, as tsc emits enums and namespaces. What is read before, during and after the filling.
const log = [];
function early() {
  return typeof Color === "undefined" ? "no object" : Color.Red + "," + Color.Blue + "," + Color[1];
}
log.push("before: " + early());

var Color;
(function (Color) {
  Color[(Color["Red"] = 0)] = "Red";
  log.push("during: " + early());
  Color[(Color["Green"] = 1)] = "Green";
  Color[(Color["Blue"] = 2)] = "Blue";
})(Color || (Color = {}));
log.push("after: " + early(), Object.keys(Color).join(), JSON.stringify(Color));

// A member whose value is computed by a call that reads the others.
var Mask;
(function (Mask) {
  Mask[(Mask["A"] = 1)] = "A";
  Mask[(Mask["B"] = seen())] = "B";
  Mask[(Mask["C"] = Mask.A | 4)] = "C";
})(Mask || (Mask = {}));
function seen() {
  return Mask.A + (Mask.C === undefined ? 10 : 20);
}
log.push("mask: " + [Mask.A, Mask.B, Mask.C, seen()].join());

// Two blocks fill one enum.
var Merged;
(function (Merged) {
  Merged[(Merged["One"] = 1)] = "One";
})(Merged || (Merged = {}));
const between = Merged.Two;
(function (Merged) {
  Merged[(Merged["Two"] = 2)] = "Two";
})(Merged || (Merged = {}));
log.push("merged: " + [Merged.One, between, Merged.Two, Object.keys(Merged).join("|")].join());

// The filling stops halfway.
var Broken;
try {
  (function (Broken) {
    Broken["First"] = "first";
    if (log.length) throw new Error("stop");
    Broken["Second"] = "second";
  })(Broken || (Broken = {}));
} catch (error) {
  log.push("caught " + error.message);
}
function readBroken() {
  return Broken.First + "," + Broken.Second + "," + ("Second" in Broken);
}
log.push("broken: " + readBroken());
Broken.Second = "late";
log.push("mended: " + readBroken());

// Filled without a function, and then changed in every way.
const table = {};
table.a = 1;
table.b = "two";
table.c = null;
table.d = undefined;
function readTable() {
  return [table.a, table.b, table.c, table.d, Object.keys(table).join("")].join();
}
log.push("table: " + readTable());
delete table.b;
log.push("deleted: " + readTable() + " " + ("b" in table));
table.b = 2;
log.push("added again: " + readTable());
table.a = "one";
log.push("other type: " + readTable());
Object.defineProperty(table, "c", {
  get() {
    return "got";
  },
  enumerable: false,
  configurable: true,
});
log.push("accessor: " + readTable());
Object.freeze(table);
try {
  table.a = 5;
} catch (error) {
  log.push(error.constructor.name);
}
log.push("frozen: " + readTable() + " " + Object.isFrozen(table));

// A name that the prototype takes never becomes a property of the object.
const below = {};
Object.setPrototypeOf(below, {
  set caught(value) {
    log.push("setter got " + value);
  },
  get caught() {
    return "inherited";
  },
});
below.caught = 1;
below.own = 2;
function readBelow() {
  return [below.caught, below.own, Object.keys(below).join("|")].join();
}
log.push("below: " + readBelow());
Object.setPrototypeOf(below, null);
log.push("alone: " + readBelow());
below.caught = 3;
log.push("stored: " + readBelow());

// Some names come only on one path.
const sometimes = {};
sometimes.always = 1;
if (log.length > 1000) sometimes.never = 2;
if (log.length > 1) sometimes.here = 3;
sometimes.last = 4;
function readSometimes() {
  return [sometimes.always, sometimes.never, sometimes.here, sometimes.last].join();
}
log.push("sometimes: " + readSometimes());

// Copies taken while the object is filled.
const source = {};
source.x = 1;
const half = { ...source };
const halfAssigned = Object.assign({}, source);
source.y = 2;
const whole = { ...source };
log.push(
  "copies: " + [JSON.stringify(half), JSON.stringify(halfAssigned), JSON.stringify(whole), half.y, whole.y].join(),
);

// A namespace, with functions that read each other through it.
var Shapes;
(function (Shapes) {
  function area(r) {
    return Shapes.PI * r * r;
  }
  Shapes.area = area;
  Shapes.PI = 3;
  Shapes.twice = function (r) {
    return 2 * Shapes.area(r);
  };
})(Shapes || (Shapes = {}));
log.push("namespace: " + [Shapes.area(2), Shapes.twice(1), Object.keys(Shapes).join("|")].join());

// In a loop each turn makes an object of its own.
const made = [];
for (let i = 0; i < 3; i++) {
  const each = {};
  each.index = i;
  if (i === 1) made.push(each.square);
  each.square = i * i;
  made.push(each);
}
log.push("loop: " + JSON.stringify(made));

// A switch over the members.
var State;
(function (State) {
  State[(State["Start"] = 0)] = "Start";
  State[(State["Middle"] = 1)] = "Middle";
  State[(State["End"] = 2)] = "End";
})(State || (State = {}));
class Machine {
  constructor() {
    this.state = State.Start;
    this.steps = 0;
  }
  step() {
    switch (this.state) {
      case State.Start:
        this.state = State.Middle;
        break;
      case State.Middle:
        this.state = this.steps > 5 ? State.End : State.Start;
        break;
      case State.End:
        return false;
      default:
        throw new Error("unknown state " + this.state);
    }
    this.steps++;
    return true;
  }
}
const machine = new Machine();
while (machine.step());
log.push("machine: " + machine.steps + " " + State[machine.state]);

console.log(log.join("\n"));
