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
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = subject.__defineSetter__("an", callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(subject.first === item, subject.first.double(), subject.second === item, subject.second.double());
console.log(typeof subject.an, subject.an === undefined);
