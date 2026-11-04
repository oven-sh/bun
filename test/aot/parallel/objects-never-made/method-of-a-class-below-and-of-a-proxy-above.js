// A class below overrides the method, and another stands below a Proxy, whose trap is handed the receiver of every read that goes past the class.
const seen = [];
class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
}
class Twice extends Counter {
  add(x) {
    return super.add(x) + super.add(x);
  }
}
function Bare() {
  this.n = 5;
}
Bare.prototype = new Proxy(
  {},
  {
    get(target, key, receiver) {
      if (key !== "add") return undefined;
      seen.push(receiver);
      receiver.n = 50;
      return function (x) {
        return this.n + x;
      };
    },
  },
);
function below(i) {
  return new Twice().add(i);
}
function past(i) {
  return new Bare().add(i);
}
let sum = 0;
for (let i = 0; i < 30; i++) sum += below(i) + past(i);
console.log(sum, seen.length, seen[2].n);
