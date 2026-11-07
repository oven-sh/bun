// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(
  (
    await Array.fromAsync(
      (async function* () {
        yield 1;
        yield 2;
      })(),
    )
  ).length,
  (await Array.fromAsync([Promise.resolve(3)]))[0],
);
