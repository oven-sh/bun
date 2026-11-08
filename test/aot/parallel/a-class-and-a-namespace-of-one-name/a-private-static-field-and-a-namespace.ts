class Counter {
  static #made = 0;
  static make(by: number) { Counter.#made += by; return Counter.#made; }
}
namespace Counter {
  export function twice(by: number) { return Counter.make(by) * 2; }
}
console.log(Counter.twice(Number(process.argv[2] ?? 3)));
export {};
