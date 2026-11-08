// Behind warm stores the field becomes an accessor: every store runs the setter.
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
let kept = 0, stores = 0;
Object.defineProperty(Counter, "total", { get() { return kept; }, set(value) { stores++; kept = value; }, configurable: true, enumerable: true });
console.log(Counter.adds(2), Counter.viaThis(3), Below.viaThis(4), stores, kept, Object.keys(Below).join());
