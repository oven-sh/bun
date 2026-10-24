class First {
  shared = "shared of First";
  constructor(value) {
    this.from = "first";
    this.value = value;
  }
}
class Second {
  other = "other of Second";
  shared = "shared of Second";
  constructor(value) {
    this.from = "second";
    this.doubled = value * 2;
  }
}
function Third(value) {
  this.from = "third";
  this.tripled = value * 3;
}
class Child extends First {
  own = "own";
  constructor(value) {
    super(value);
    this.child = this.from + "!";
  }
}

function show(label) {
  const o = new Child(2);
  console.log(label + ":", Object.keys(o).join(), o.from, o.value, o.doubled, o.tripled, o.shared, o.other, o.own, o.child, o instanceof First, o instanceof Second, o instanceof Child);
}
for (let i = 0; i < 3; i++) show("First");
Object.setPrototypeOf(Child, Second);
for (let i = 0; i < 3; i++) show("Second");
Object.setPrototypeOf(Child, Third);
for (let i = 0; i < 3; i++) show("Third");
Object.setPrototypeOf(Child, First);
for (let i = 0; i < 3; i++) show("First again");
Object.setPrototypeOf(Child, Object);
for (let i = 0; i < 2; i++) show("Object");
Object.setPrototypeOf(Child, null);
try {
  show("null");
} catch (error) {
  console.log("null: threw", error.constructor.name);
}
console.log(Object.keys(new Second(1)).join(), Object.keys(new First(1)).join());
