const start = Number(process.argv[2] ?? 3);
class Counter {
  static #made = 0;
  static make(by: number) { Counter.#made += by; return Counter.#made; }
}
namespace Counter {
  export const first = Counter.make(start);
}
console.log(Counter.first, Counter.make(start));
export {};
