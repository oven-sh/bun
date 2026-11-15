// A method is no field: the store ends what the compiler holds of the method.
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
function calls() { let sum = 0; for (let i = 0; i < 3000; i++) sum = (sum + Counter.method(i) + Below.method(i)) | 0; return sum; }
console.log(calls());
function replace(next) { Counter.method = next; }
replace(by => by + 2);
console.log(calls());
for (let i = 0; i < 3000; i++) replace(by => by * 3);
console.log(calls(), Below.method(7));
