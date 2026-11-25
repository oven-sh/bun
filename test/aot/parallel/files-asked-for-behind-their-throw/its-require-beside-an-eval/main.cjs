// A closure that a run left behind when it threw still loads by the require of its run, also in a file with a direct eval.
globalThis.laters = [];
for (let turn = 0; turn < 3; turn++) {
  try {
    require("./flaky.cjs");
    console.log("loaded");
  } catch (error) {
    console.log(error.message);
  }
  for (const later of laters) {
    try {
      console.log(later());
    } catch (error) {
      console.log(error.message);
    }
  }
}
