// Text that is compiled at run time stores, under names that are no fields, into objects that compiled code laid out.
// The same store comes again and again, so whatever is remembered of the first ones answers for the later ones.
function Bag() {}
Bag.prototype = Object.create(null);

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

function Counted() {
  this.count = 0;
}
Counted.prototype.describe = function () {
  return Object.keys(this).join();
};

const fillBag = new Function("Bag", "a", "b", "const bag = new Bag(); bag.first = a; bag.second = b; bag.first = a + 1; return bag;");
const label = new Function("object", "text", "object.label = text; object.label = object.label + '!'; return object;");
const labelStrictly = new Function("object", "text", "'use strict'; object.label = text; return object;");
const many = new Function("object", "for (let i = 0; i < 3; i++) { object.a = i; object.b = i; object.c = i; object.d = i; object.e = i; object.f = i; object.g = i; object.h = i; object.i = i; object.j = i; } return object;");

let sum = 0;
let last;
for (let i = 0; i < 300; i++) {
  last = fillBag(Bag, i, "x" + i);
  sum += last.first + last.second.length;
}
console.log(sum, Object.keys(last).join(), last.first, last.second, Object.getPrototypeOf(last) === Bag.prototype);

for (let i = 0; i < 300; i++) last = label(new Point(i, -i), "p" + i);
console.log(JSON.stringify(last), Object.keys(last).join());

for (let i = 0; i < 300; i++) last = label(new Counted(), "c" + i);
console.log(last.describe(), last.label, last.count);

for (let i = 0; i < 100; i++) last = many(new Bag());
console.log(Object.keys(last).join(""), Object.values(last).join(""));
for (let i = 0; i < 100; i++) last = many(new Point(1, 2));
console.log(Object.keys(last).join(""), Object.values(last).join(""));

// An object that takes no more properties.
for (let i = 0; i < 50; i++) last = label(Object.preventExtensions(new Point(i, i)), "no");
console.log(JSON.stringify(last), "label" in last);
let thrown = 0;
for (let i = 0; i < 50; i++) {
  try {
    labelStrictly(Object.preventExtensions(new Point(i, i)), "no");
  } catch (error) {
    if (error instanceof TypeError) thrown++;
  }
}
console.log(thrown);
for (let i = 0; i < 50; i++) last = label(Object.freeze(label(new Point(i, i), "kept")), "no");
console.log(JSON.stringify(last));
thrown = 0;
for (let i = 0; i < 50; i++) {
  try {
    labelStrictly(Object.freeze(label(new Point(i, i), "kept")), "no");
  } catch (error) {
    if (error instanceof TypeError) thrown++;
  }
}
console.log(thrown);

// The name is deleted and comes again behind the others.
for (let i = 0; i < 50; i++) {
  last = label(new Point(i, i), "first");
  last.other = 1;
  delete last.label;
  label(last, "again");
}
console.log(Object.keys(last).join(), last.label);

// A setter, then a property that cannot be written, appear above the objects after the stores have been remembered.
const seen = [];
Object.defineProperty(Point.prototype, "label", {
  configurable: true,
  set(value) {
    seen.push(value);
  },
  get() {
    return "from above";
  },
});
for (let i = 0; i < 3; i++) last = label(new Point(i, i), "s" + i);
console.log(seen.join(), Object.keys(last).join(), last.label);
Object.defineProperty(Point.prototype, "label", { configurable: true, writable: false, value: "fixed" });
for (let i = 0; i < 3; i++) last = label(new Point(i, i), "w" + i);
console.log(Object.keys(last).join(), last.label);
thrown = 0;
try {
  labelStrictly(new Point(0, 0), "w");
} catch (error) {
  if (error instanceof TypeError) thrown++;
}
console.log(thrown);
delete Point.prototype.label;
for (let i = 0; i < 3; i++) last = label(new Point(i, i), "back" + i);
console.log(Object.keys(last).join(), last.label);

// The prototype of a bag gets a setter too.
Object.defineProperty(Bag.prototype, "first", {
  set(value) {
    seen.push("bag " + value);
  },
});
seen.length = 0;
last = fillBag(Bag, 1, "b");
console.log(seen.join(), Object.keys(last).join());

// Objects live on through collections with what was stored.
const kept = [];
for (let i = 0; i < 2000; i++) kept.push(label(new Counted(), "k" + i));
Bun.gc(true);
let right = 0;
for (let i = 0; i < kept.length; i++) if (kept[i].label === "k" + i + "!" && kept[i].count === 0) right++;
console.log(right);
