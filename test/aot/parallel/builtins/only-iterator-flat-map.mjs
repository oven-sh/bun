// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(
  [1, 2]
    .values()
    .flatMap(n => [n, n])
    .next().value,
);
