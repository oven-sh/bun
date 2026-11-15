class Level {
  static #at = 1;
  static raise(by) { return Level.#at += by; }
}
Level.top = { at: Level.raise(1) };
console.log(Level.top.at, Level.raise(Number(process.argv[2] ?? 3)));
