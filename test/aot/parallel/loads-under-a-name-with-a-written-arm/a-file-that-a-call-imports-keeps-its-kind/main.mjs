// The name of the load is chosen at run time, and the arm that is written is what runs: the executable holds setup.cjs and loads it as `bun <file>` does, which prints "strict |  [object Module]", as where the name is written outright; `bun build --compile` prints "sloppy | default [object Module]".
let told;
try {
  const loaded = await import(process.env.MADE_UP_SETUP || "./setup.cjs");
  told = globalThis.madeUpKind + " | " + Object.keys(loaded).join(",") + " " + Object.prototype.toString.call(loaded);
} catch (error) {
  told = "not loaded";
}
console.log(told);
