// In f2 of generators.ts `const spare = new Box(a, null)` is handed to a call in front of two yields, and `spare.next` and `spare.on` are read behind them.
// Beside the other file the compiler makes the object on some ways only. Behind the yields it read the object's word of the frame twice, and the build stopped at its own
// check: "InvalidGuard: the guard does not prove what the operation relies on". Found by ../../../fuzz/values-across-joins.ts. The output is that of plain Bun.
// Flags: --aot-validate
// Alone: how far the object is moved goes by what else the executable holds
const programs = {
  0: () => import("./generators.ts"),
  1: () => import("./beside.ts"),
};
await programs[process.argv[2] ?? 0]();
