class Level {
  static #at = 1;
  static get #now() { return Level.#at; }
  static set #now(to: number) { Level.#at = to * 2; }
  static raise(by: number) { Level.#now = Level.#now + by; return Level.#now; }
}
console.log(Level.raise(Number(process.argv[2] ?? 3)), Level.raise(1));
export {};
