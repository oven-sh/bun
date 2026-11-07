// `F.prototype.m.call(object)` and `F.prototype.m` as a value, while the program changes the member, the holder above it, the link between them and the property itself.
const lines = [];
const say = (...words) => lines.push(words.join(" "));

function Shape(side) { this.side = side; }
Shape.prototype.area = function () { return this.side * this.side; };
Shape.prototype.name = function (prefix, suffix) { return prefix + "shape" + this.side + suffix; };
function Box(side) { Shape.call(this, side); this.height = 2; }
Object.setPrototypeOf(Box.prototype, Shape.prototype);
Box.prototype.area = function () { return Shape.prototype.area.call(this) * this.height; };
Box.prototype.name = function () { return Shape.prototype.name.apply(this, arguments) + "!"; };
Box.prototype.inherited = function () { return Box.prototype.describe.call(this); };
Shape.prototype.describe = function () { return "described " + this.side; };

const boxes = [new Box(1), new Box(2), new Box(3)];
function all(label) {
  let text = label;
  for (const box of boxes) {
    let one;
    try { one = box.area() + "," + box.name("<", ">") + "," + box.inherited(); } catch (error) { one = error.constructor.name; }
    text += " | " + one;
  }
  say(text);
}
for (let i = 0; i < 3; i++) all("as written");

say("the value", Shape.prototype.area === Shape.prototype.area, typeof Shape.prototype.area, Shape.prototype.area.length, Shape.prototype.name.length);
function sameAsKept(kept) { return Shape.prototype.area === kept; }
const keptArea = Shape.prototype.area;
say("kept", sameAsKept(keptArea), sameAsKept(Box.prototype.area), new Shape(1).area === keptArea);

say("with the function itself as this", String(Shape.prototype.area.call(Shape)), String(Shape.prototype.describe.call(Shape.prototype)));
say("with a primitive", String(Shape.prototype.area.call(7)), Shape.prototype.describe.call("text"));
say("with nothing", (() => { try { return Shape.prototype.area.call(undefined); } catch (error) { return error.constructor.name; } })());

Shape.prototype.area = function () { return -this.side; };
all("another member");
say("kept", sameAsKept(keptArea), sameAsKept(Shape.prototype.area));

delete Shape.prototype.area;
all("no member");
say("absent", Shape.prototype.area, sameAsKept(undefined));

let reads = 0;
Object.defineProperty(Shape.prototype, "area", { configurable: true, get() { reads++; return function () { return "got " + this.side; }; } });
all("an accessor");
say("reads", reads, Shape.prototype.area === Shape.prototype.area);
Object.defineProperty(Shape.prototype, "area", { configurable: true, writable: true, value: keptArea });
all("the first member again");
say("kept", sameAsKept(keptArea));

Box.prototype.describe = function () { return "a box's own " + this.side; };
all("the lower holder gets the name");
delete Box.prototype.describe;
all("and loses it");

const between = { describe() { return "from between " + this.side; } };
Object.setPrototypeOf(between, Shape.prototype);
Object.setPrototypeOf(Box.prototype, between);
all("another link");
Object.setPrototypeOf(Box.prototype, Shape.prototype);
all("the first link again");

const firstPrototype = Shape.prototype;
Shape.prototype = { area() { return "replaced " + this.side; }, name() { return "replaced name"; }, describe() { return "replaced describe"; } };
all("another object under prototype");
say("kept", sameAsKept(keptArea), firstPrototype.area === keptArea);
Shape.prototype = undefined;
all("nothing under prototype");
Shape.prototype = 5;
all("a number under prototype");
Shape.prototype = firstPrototype;
all("the first object again");

// Read before the member is there, and before anything was constructed.
function Early() {}
function readEarly() { return typeof Early.prototype.run + " " + (Early.prototype.run ? Early.prototype.run.call({ n: 1 }) : "-"); }
say("early", readEarly());
Early.prototype.run = function () { return "ran " + this.n; };
say("early", readEarly(), readEarly());
new Early();
say("early", readEarly());

// A class: the property cannot change, the members can.
class Animal { constructor(name) { this.name = name; } speak() { return this.name + " speaks"; } static make() { return new this("made"); } }
class Dog extends Animal { speak() { return Animal.prototype.speak.call(this) + " loudly"; } }
const dogs = [new Dog("a"), new Dog("b")];
const speak = () => dogs.map(dog => dog.speak()).join(";");
say(speak(), speak());
Animal.prototype.speak = function () { return this.name + " is silent"; };
say(speak());
try { "use strict"; Animal.prototype = {}; } catch (error) { say(error.constructor.name); }
say(speak(), Animal.prototype.speak.call({ name: "anyone" }));

// A function that is made more than once.
function makeCounter(step) {
  function Counter() { this.n = 0; }
  Counter.prototype.next = function () { return (this.n += step); };
  return { Counter, twice(counter) { return Counter.prototype.next.call(counter) + Counter.prototype.next.call(counter); } };
}
const byOne = makeCounter(1), byTen = makeCounter(10);
say(byOne.twice(new byOne.Counter()), byTen.twice(new byTen.Counter()), byOne.twice(new byTen.Counter()), byOne.Counter.prototype.next === byTen.Counter.prototype.next);

// The arguments run code between the read and the call.
function Late() {}
Late.prototype.pick = function (value) { return "first " + value; };
function swap() { Late.prototype.pick = function (value) { return "second " + value; }; return "x"; }
say(Late.prototype.pick.call(null, swap()), Late.prototype.pick.call(null, "y"));

// A base that never makes an object of its own.
function Base() { this.made = "base"; }
Base.prototype.label = function (mark) { return mark + this.made + this.n; };
function Top() {}
Top.prototype.above = function () { return "above " + this.n; };
Object.setPrototypeOf(Base.prototype, Top.prototype);
function Derived(n) { Base.call(this); this.n = n; }
Object.setPrototypeOf(Derived.prototype, Base.prototype);
Derived.prototype.label = function (mark) { return "[" + Base.prototype.label.call(this, mark) + " " + Base.prototype.above.call(this) + "]"; };
const derived = [new Derived(1), new Derived(2)];
const labels = mark => { try { return derived.map(one => one.label(mark)).join(""); } catch (error) { return error.constructor.name; } };
for (let i = 0; i < 4; i++) say("base only", labels("#" + i));
const firstLabel = Base.prototype.label;
Base.prototype.label = function (mark) { return "other" + mark; };
say("base only, another member", labels("a"), labels("b"));
Base.prototype.label = firstLabel;
say("base only, the first again", labels("c"));
Base.prototype.above = function () { return "nearer"; };
say("base only, the name comes nearer", labels("d"));
delete Base.prototype.above;
say("base only, and goes", labels("e"));
Top.prototype.above = function () { return "changed above"; };
say("base only, changed above", labels("f"));
Object.setPrototypeOf(Base.prototype, { above() { return "another parent"; } });
say("base only, another parent", labels("g"));
Object.setPrototypeOf(Base.prototype, null);
say("base only, no parent", labels("h"));
Base.prototype = { label() { return "replaced"; }, above() { return "replaced too"; } };
say("base only, another object under prototype", labels("i"), new Base().label());

// A function that nobody constructs: its members are lent to other objects.
function Lender() {}
Lender.prototype.double = function () { return this.n * 2; };
const borrowers = [{ n: 1 }, { n: 2 }];
const lend = () => { try { return borrowers.map(one => Lender.prototype.double.call(one)).join(","); } catch (error) { return error.constructor.name; } };
for (let i = 0; i < 3; i++) say("lent", lend());
Lender.prototype.double = function () { return this.n * 3; };
say("lent, another member", lend());
Lender.prototype = { double() { return "replaced " + this.n; } };
say("lent, another object under prototype", lend(), new Lender().double(), Object.getPrototypeOf(new Lender()) === Lender.prototype);
function LateLender() {}
const lendLate = () => (LateLender.prototype.half ? LateLender.prototype.half.call({ n: 8 }) : "nothing yet");
say("lent late", lendLate(), lendLate());
LateLender.prototype.half = function () { return this.n / 2; };
say("lent late", lendLate(), lendLate(), new LateLender().half.call({ n: 2 }));
function Replaced() { this.n = 5; }
const readReplaced = () => typeof Replaced.prototype.show + " " + (Replaced.prototype.show ? Replaced.prototype.show.call({ n: 6 }) : "-");
Replaced.prototype.show = function () { return "first " + this.n; };
say("read, then replaced", readReplaced(), readReplaced());
Replaced.prototype = Object.create({ show() { return "second " + this.n; } });
say("read, then replaced", readReplaced(), new Replaced().show(), new Replaced() instanceof Replaced);

console.log(lines.join("\n"));
