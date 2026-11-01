// `source` begins as an object with the members `start` and `next`, and then holds a class whose static members have those names.
class Counter {
  static start = 3;
  static next() {
    return Counter.start + 1;
  }
}

class Heir extends Counter {
  static start = 10;
}

let source = {
  start: 1,
  next() {
    return 2;
  },
};

function read(from) {
  return from.start + from.next();
}

const seen = [];
for (const next of [source, Counter, Heir, source]) {
  source = next;
  seen.push(read(source), typeof source);
}
console.log(seen.join(" "));
source = Counter;
source.start = 20;
console.log(read(source), read(Heir), Object.keys(source).join());
