// Built-ins change the class behind warm stores: Object.assign lays another function over a method, Object.defineProperty makes the field read-only, Reflect.set says what became of its store.
class Counter {
  static total = 0;
  static method(by) { return by + 100; }
  static adds(by) { Counter.total = (Counter.total + by) | 0; return Counter.total; }
}
class Below extends Counter {}
globalThis.keep = [new Below()];
function calls() { let sum = 0; for (let i = 0; i < 3000; i++) sum = (sum + Counter.method(i) + Below.method(i)) | 0; return sum; }
let sum = 0;
for (let i = 0; i < 3000; i++) sum = (sum + Counter.adds(i)) | 0;
console.log(calls(), sum);
Object.assign(Counter, { method: by => by * 3 });
console.log(calls(), Below.method(7));
Object.defineProperty(Counter, "total", { writable: false });
try { Counter.adds(1); console.log("stored"); } catch (error) { console.log("TypeError", error instanceof TypeError); }
console.log(Reflect.set(Counter, "total", 1), Counter.total, Below.total);
