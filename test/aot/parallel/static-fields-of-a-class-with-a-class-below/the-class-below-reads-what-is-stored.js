// Every store is seen through the class below, and a store through the class below makes a field of its own.
class Counter {
  static total = 0;
  static handler = by => by + 1;
  static method(by) { return by + 100; }
  static adds(by) { Counter.total = (Counter.total + by) | 0; return Counter.total; }
  static viaThis(by) { this.total = (this.total + by) | 0; return this.total; }
}
class Below extends Counter {}
globalThis.keep = [new Below()];
function warm() { let sum = 0; for (let i = 0; i < 3000; i++) sum = (sum + Counter.adds(i) + Counter.viaThis(1)) | 0; return sum; }
console.log(warm(), Counter.total, Below.total, Object.keys(Counter).join());
Counter.total = 5;
console.log(Below.total, Below.adds(1), Below.total);
console.log(Below.viaThis(10), Object.keys(Below).join(), Counter.total, Below.total);
console.log(warm(), Counter.total, Below.total);
