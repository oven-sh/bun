import type { Level, Pair } from "./library.js";

function sum(pair: Pair, level: Level): number {
  return pair.first + pair.second + level;
}
console.log(sum({ first: 1, second: 2, sum: () => 3 }, 2));
