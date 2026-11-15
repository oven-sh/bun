// A bundle that throws runs again, and one whose runtime loads a file beside it loads it again.
if (process.argv.length > 9) require("./other.cjs");
for (let i = 0; i < 4; i++) {
  try {
    const { Point, runs, two } = require("./throws.cjs");
    console.log(i, new Point(i).made, new Point(i).x, runs, two(), two());
  } catch (error) {
    console.log(i, error.message);
  }
}
for (let i = 0; i < 3; i++) {
  try {
    const { other, times, load } = require("./outside.cjs");
    console.log(i, other, times, load("./other.cjs").name, globalThis.others, load("./throws.cjs").runs);
  } catch (error) {
    console.log(i, error.message);
  }
}
