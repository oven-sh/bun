import type { Pair } from "./library.js";

function sum(pair: Pair): number {
  return pair.first + pair.second;
}
console.log(sum({ first: 1, second: 2 }));
