class Level {
  static #at = 1;
  static raise(options: Level.Options) { return Level.#at += options.by; }
}
namespace Level {
  export interface Options { by: number }
}
console.log(Level.raise({ by: Number(process.argv[2] ?? 3) }));
export {};
