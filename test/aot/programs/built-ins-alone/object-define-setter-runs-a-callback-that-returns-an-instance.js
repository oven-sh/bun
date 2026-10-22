class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const subject = { first: 1.5, second: "two", third: item };
function callback() {
  console.log("callback", arguments.length);
  return new Item(2.5);
}
const result = subject.__defineSetter__("an", callback);
console.log(typeof result, result === undefined, typeof subject, Object.keys(subject).join());
console.log(typeof subject.first, subject.first + 1, typeof subject.second, subject.second.length, subject.second);
console.log(subject.third === item, subject.third.double(), typeof subject.an, subject.an === undefined);
