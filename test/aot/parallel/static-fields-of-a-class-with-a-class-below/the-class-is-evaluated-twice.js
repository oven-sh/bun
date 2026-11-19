// Two class objects out of one class expression, each with a class below: each holds its own field.
function make() {
  class Counter {
    static total = 0;
    static adds(by) { Counter.total = (Counter.total + by) | 0; return Counter.total; }
  }
  class Below extends Counter {}
  globalThis.keep = [new Below()];
  return [Counter, Below];
}
const [One, BelowOne] = make();
const [Two, BelowTwo] = make();
let sum = 0;
for (let i = 0; i < 3000; i++) sum = (sum + One.adds(1) + Two.adds(2)) | 0;
console.log(sum, One.total, Two.total, BelowOne.total, BelowTwo.total);
