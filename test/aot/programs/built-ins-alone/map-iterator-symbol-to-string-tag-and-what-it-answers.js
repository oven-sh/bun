class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = new Map([["first", item]]).entries();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result, typeof subject);
const step = subject.next();
console.log(step.done, typeof step.value, step.value === undefined, [...subject].length);
