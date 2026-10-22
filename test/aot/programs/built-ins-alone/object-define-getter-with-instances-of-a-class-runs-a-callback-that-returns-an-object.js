class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: item, second: item };
function callback() {
  console.log("callback", this === subject, arguments.length);
  return { made: 1.5 };
}
const result = subject.__defineGetter__("an", callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(subject.first === item, subject.first.double(), subject.second === item, subject.second.double(), typeof subject.an);
console.log(Object.keys(subject.an).join(), typeof subject.an.made, subject.an.made + 1);
