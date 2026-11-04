// Twelve rings of two modules, each entered at its other file some jobs behind the first call: from one job, where the loader has taken one step for the first graph, to twelve, where that graph has run.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const rings = [
  [() => import("./a1.mjs"), () => import("./b1.mjs")],
  [() => import("./a2.mjs"), () => import("./b2.mjs")],
  [() => import("./a3.mjs"), () => import("./b3.mjs")],
  [() => import("./a4.mjs"), () => import("./b4.mjs")],
  [() => import("./a5.mjs"), () => import("./b5.mjs")],
  [() => import("./a6.mjs"), () => import("./b6.mjs")],
  [() => import("./a7.mjs"), () => import("./b7.mjs")],
  [() => import("./a8.mjs"), () => import("./b8.mjs")],
  [() => import("./a9.mjs"), () => import("./b9.mjs")],
  [() => import("./a10.mjs"), () => import("./b10.mjs")],
  [() => import("./a11.mjs"), () => import("./b11.mjs")],
  [() => import("./a12.mjs"), () => import("./b12.mjs")],
];
for (let turns = 1; turns <= rings.length; turns++) {
  const [enterAtA, enterAtB] = rings[turns - 1];
  const first = enterAtA();
  for (let turn = 0; turn < turns; turn++) await null;
  try {
    await Promise.all([first, enterAtB()]);
  } catch (e) {
    console.log(turns + " turns later: " + e.name);
  }
}
/* Output:
b1 runs
a1 sees B
b2 runs
a2 sees B
b3 runs
a3 sees B
b4 runs
a4 sees B
b5 runs
a5 sees B
b6 runs
a6 sees B
b7 runs
a7 sees B
b8 runs
a8 sees B
b9 runs
a9 sees B
b10 runs
a10 sees B
b11 runs
a11 sees B
b12 runs
a12 sees B
*/
