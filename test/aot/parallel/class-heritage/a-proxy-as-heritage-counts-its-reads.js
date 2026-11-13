// A class that nobody uses is defined below a heritage that has been one of two classes so far, and is now a proxy that counts the reads of `prototype`.
class A { who() { return "a"; } }
class C { who() { return "c"; } }
function define(Base) { class Dropped extends Base { } return 1; }
function defineAndUse(Base) { return new (class extends Base { })().who(); }

let reads = 0;
function deed() {
  return new Proxy(A, { get(target, key, receiver) { if (key === "prototype") reads++; return Reflect.get(target, key, receiver); } });
}
let sum = 0;
for (let i = 0; i < 200; i++) sum += define(i & 1 ? A : C);
console.log(String(sum), defineAndUse(A), defineAndUse(C), String(reads));
const watched = deed();
console.log(String(define(watched)), String(reads), defineAndUse(watched), String(reads));
for (let i = 0; i < 200; i++) sum += define(i % 3 ? A : watched);
console.log(String(sum), String(reads));
