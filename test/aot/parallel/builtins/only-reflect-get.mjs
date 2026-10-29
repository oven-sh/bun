// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(
  Reflect.get({ a: 1 }, "a"),
  Reflect.get(
    {
      get b() {
        return this.c;
      },
    },
    "b",
    { c: 2 },
  ),
);
