const Level = class Named {
  static #at = 1;
  static raise(by: number) { return Named.#at += by; }
};
console.log(Level.raise(Number(process.argv[2] ?? 3)));
export {};
