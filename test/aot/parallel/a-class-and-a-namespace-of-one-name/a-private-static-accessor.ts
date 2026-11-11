const start = Number(process.argv[2] ?? 3);
class Level {
  static #at = 1;
  static get #now() { return Level.#at; }
  static set #now(to: number) { Level.#at = to * 2; }
  static raise(by: number) { Level.#now = Level.#now + by; return Level.#now; }
}
namespace Level {
  export function top() { return Level.raise(start); }
}
console.log(Level.top(), Level.raise(1), Object.keys(Level).join());
export {};
