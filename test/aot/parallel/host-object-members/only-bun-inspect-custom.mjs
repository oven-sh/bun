// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(
  Bun.inspect({
    [Bun.inspect.custom]() {
      return "mine";
    },
  }),
);
