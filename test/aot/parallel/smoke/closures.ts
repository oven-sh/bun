// Closures that count, capture loop variables and are handed around.
function counter(start: number) {
  let value = start;
  return {
    next: () => ++value,
    reset() {
      value = start;
    },
  };
}
const a = counter(1);
const b = counter(10);
a.next();
a.next();
b.next();
a.reset();
console.log(a.next(), b.next());
const callbacks: (() => number)[] = [];
for (let i = 0; i < 3; i++) callbacks.push(() => i * i);
console.log(callbacks.map(callback => callback()));
function compose<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C {
  return a => g(f(a));
}
console.log(compose((n: number) => n + 1, n => String(n) + "!")(41));
