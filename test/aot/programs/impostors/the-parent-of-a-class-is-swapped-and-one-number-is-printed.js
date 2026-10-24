class First {
  constructor(value) {
    this.from = 1;
    this.value = value;
  }
}
class Second {
  constructor(value) {
    this.from = 2;
    this.doubled = value * 2;
  }
}
class Child extends First {
  constructor(value) {
    super(value);
    this.child = 7;
  }
}
let sum = 0;
function note(o) {
  sum = (sum * 31 + o.from * 1000 + (o.value === undefined ? 0 : o.value) * 100 + (o.doubled === undefined ? 0 : o.doubled) * 10 + o.child + Object.keys(o).length * 10000) % 1000003;
}
note(new Child(1));
Object.setPrototypeOf(Child, Second);
note(new Child(2));
note(new Child(3));
Object.setPrototypeOf(Child, First);
note(new Child(4));
console.log(sum);
