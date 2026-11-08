// Behind warm stores the field is made read-only, and then writable again.
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
const before = Counter.total;
Object.defineProperty(Counter, "total", { writable: false });
function tried(by) { try { return Counter.adds(by); } catch (error) { return error instanceof TypeError ? "TypeError" : String(error); } }
console.log(tried(1), Counter.total === before);
Object.defineProperty(Counter, "total", { writable: true });
console.log(tried(1) === before + 1, Below.total === before + 1);
