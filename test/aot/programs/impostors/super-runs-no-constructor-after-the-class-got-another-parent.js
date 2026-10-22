class First {
  constructor(value) {
    this.from = "first";
    this.value = value;
  }
}

class Second {
  constructor(value) {
    this.from = "second";
    this.doubled = value * 2;
  }
}

class Child extends First {
  constructor(value) {
    super(value);
    this.child = true;
  }
}

const before = new Child(1);
console.log("before:", before.from, Object.keys(before).join());
Object.setPrototypeOf(Child, Second);
const after = new Child(2);
console.log("after:", after.from, Object.keys(after).join());
