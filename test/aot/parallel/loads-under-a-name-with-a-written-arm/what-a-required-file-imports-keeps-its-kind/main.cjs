// The name of the load is chosen at run time, and the arm that is written is what runs: the executable holds plug.mjs and loads it as `bun <file>` does, which prints "sloppy | default [object Module]". No build may print another kind for plain.cjs.
let told;
try {
  const plug = require(process.env.MADE_UP_PLUG || "./plug.mjs");
  told = plug.kind + " | " + plug.shape;
} catch (error) {
  told = "not loaded";
}
console.log(told);
