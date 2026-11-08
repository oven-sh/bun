// The field is deleted and stored again: it comes last among the keys.
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
delete Counter.total;
console.log(Counter.total, Below.total, Object.keys(Counter).join());
Counter.total = 1;
console.log(warm(), Object.keys(Counter).join(), Below.total);
