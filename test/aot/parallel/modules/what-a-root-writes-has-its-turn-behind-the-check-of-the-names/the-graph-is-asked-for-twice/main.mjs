// The graph fails at each import() alike, and the file never runs.
for (let turn = 0; turn < 2; turn++) {
  try {
    await import("./top.mjs");
  } catch (error) {
    console.log(turn, error.constructor.name);
  }
}
console.log("main ends");
