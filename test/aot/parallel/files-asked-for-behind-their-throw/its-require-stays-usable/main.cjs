globalThis.laters = [];
const run = () => {
  for (const later of laters) {
    try {
      console.log(later());
    } catch (error) {
      console.log(error.message);
    }
  }
};
for (let turn = 0; turn < 3; turn++) {
  try {
    require("./flaky.cjs");
    console.log("loaded");
  } catch (error) {
    console.log(error.message);
  }
  run();
}
