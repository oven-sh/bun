// m.mjs imports k.cjs, k.cjs requires m.mjs and then throws. Whoever requires m.mjs is asked twice.
for (const attempt of [1, 2]) {
  try {
    console.log(attempt, Object.keys(require("./m.mjs")).join());
  } catch (error) {
    console.log(attempt, "threw", error.message);
  }
}
