let kept;
do {
  const K = Symbol("k");
  const holder = { [K]: 1 };
  kept = [Object.getOwnPropertySymbols(holder)[0] === K, holder[K]];
} while (false);
console.log(kept.join());
console.log((0, eval)("1 + 1"));
